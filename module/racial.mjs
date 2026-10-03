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
 *   grantsTalent: <ids>             Talents it gives - kept if the Trait is lost ("you do not lose that Talent")
 *   addendum: >                     its Addendum effect's text box, shown as written in the Item's Options tab
 *   tail: true                      a tail it may lose - the Options tab's Tail lost box (the `tailed` question)
 *
 * An Option is a file of its own beside it, `traits/races/<race>/<trait>/<option>.dbu`, marked `optionOf: <trait>`; its
 * script is added to the Trait's between `#@ option` markers, and it may say `choose`, `grantsUnique`, `grantsTalent`.
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

/** One printed line as HTML: escaped, its links made links. */
function lineHtml(text) {
  return Handlebars.escapeExpression(text).replace(LINK, (whole, label, url) =>
    `<a href="${url}" target="_blank" rel="noopener">${label}</a>`);
}

/**
 * A Racial Trait Item's text as shown on the Traits tab: its printed lines, and where it has an Option effect, that line
 * with only what was chosen under it - "(3)-[Option]:" and the Option's own line - not the whole list (the user's).
 */
export function racialTraitLines(item) {
  const picked = (item?.system?.chosen ?? []).filter(entry => entry.key === "option")
    .map(entry => getTrait(entry.value)).filter(Boolean);
  const lines = printedLines(item?.system?.text || "");
  const out = [];
  for (let at = 0; at < lines.length; at++) {
    const line = lines[at];
    const option = picked.length && /^(\(\d+\)-\[Option\]):/.exec(line);
    if (!option) {
      out.push({ html: lineHtml(line), bullet: /^[*\u2022]/.test(line), gap: !line });
      continue;
    }
    out.push({ html: lineHtml(`${option[1]}:`), bullet: false, gap: false });
    for (const chosen of picked) {
      out.push({ html: lineHtml(`*${printedLines(chosen.text).join(" ")}`), bullet: true, gap: false });
    }
    // The list it was chosen from is left out.
    while ((at + 1 < lines.length) && /^[*\u2022]/.test(lines[at + 1])) at++;
  }
  return out;
}

/** A list header - `a, b` or a single value - as a list. */
const listOf = raw => [].concat(raw ?? []).flatMap(entry => String(entry).split(",")).map(id => id.trim()).filter(Boolean);

/** Every Racial Trait there is to take - its Options are not. */
export function racialTraitFiles() {
  return traitsOfKind("races").filter(trait => !trait.optionOf);
}

/** A Racial Trait's Options, in the order its text lists them (their `order:`), not by name (the user's). */
export function racialOptionsOf(id) {
  return traitsOfKind("races").filter(trait => trait.optionOf === id)
    .sort((a, b) => (orderOf(a) - orderOf(b)) || a.name.localeCompare(b.name));
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
 * Every Racial Trait there is, in the order the picker and the list show them: this character's race first, then every
 * other race by the race's name (not the Trait's), each race's Traits in the order its page prints them (the user's).
 */
export function racialTraitsInOrder(race, traits = racialTraitFiles()) {
  return traits.slice().sort((a, b) =>
    (Number(b.owner === race) - Number(a.owner === race))
    || raceName(a.owner).localeCompare(raceName(b.owner))
    || (orderOf(a) - orderOf(b))
    || a.name.localeCompare(b.name));
}

/** What the rules call a Racial Trait: its Category (Body/Mind), and Primary or Secondary - a Subrace's is Primary. */
export function racialTraitKind(trait) {
  const importance = trait?.subrace ? "primary" : String(trait?.importance ?? "");
  return [String(trait?.category ?? ""), importance].filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(" · ");
}

/** The race (and Subrace) a Racial Trait belongs to, as read. */
export function racialTraitRace(race, subrace = "") {
  return [raceName(race), subrace ? (subraceName(race, subrace) || subrace) : ""].filter(Boolean).join(" - ");
}

/** The Racial Trait Items a character has, in the picker's order: own race's first, then by race name, then as printed. */
export function ownedRacialTraits(actor) {
  const race = actor?.system?.race;
  const fileOf = item => getTrait(item.flags?.["dbu-ttrpg"]?.sourceId ?? "");
  return Array.from(actor?.items ?? []).filter(item => item.type === RACIAL_TYPE).sort((a, b) =>
    (Number(b.system.race === race) - Number(a.system.race === race))
    || raceName(a.system.race).localeCompare(raceName(b.system.race))
    || (orderOf(fileOf(a)) - orderOf(fileOf(b)))
    || a.name.localeCompare(b.name));
}

/** What a `choose:` header offers, as [value, label] pairs. */
async function choicesFor(kind) {
  if (kind === "knowledge") {
    const { default: DBUCharacterData } = await import("./data/actor-character.mjs");
    return Object.entries(DBUCharacterData.SKILLS).filter(([key]) => key.startsWith("knowledge"))
      .map(([key, skill]) => [key, skill.label]);
  }
  if (kind === "elementalProfile") {
    const { PROFILES } = await import("./maneuvers.mjs");
    return Object.entries(PROFILES).filter(([, profile]) => /elemental/i.test(profile.label ?? ""))
      .map(([key, profile]) => [key, profile.label]);
  }
  return [];
}

/** Ask a `choose:` - one of its values, or null when backed out of. */
async function askChoice(source) {
  const offered = await choicesFor(source.choose);
  if (!offered.length) {
    ui.notifications.warn(`${source.name}: nothing to choose for "${source.choose}".`);
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

/** Ask an Option effect: "choose one of the following effects". The ids chosen, or null. */
async function askOptions(trait, options) {
  const count = Math.max(1, Number(trait.options) || 1);
  const escape = Handlebars.escapeExpression;
  const type = (count === 1) ? "radio" : "checkbox";
  const chosen = await foundry.applications.api.DialogV2.wait({
    classes: ["dbu-dialog"],
    window: { title: `${trait.name} - Option` },
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

/** A part's script with its `choose:` answered - `$choice` replaced - and the choice recorded. */
async function answered(source, chosen) {
  const script = String(source.script ?? "").trim();
  if (!source.choose) return script;
  const choice = await askChoice(source);
  if (!choice) return null;
  chosen.push({ key: source.id, value: choice.value, label: `${source.name}: ${choice.label}` });
  return script.replaceAll("$choice", choice.value);
}

/**
 * A Racial Trait's file, as the Item a character takes - its Option and choices asked now ("At Character Creation,
 * choose ..."), their scripts written into its own. Null if backed out of anywhere.
 *
 * @returns {Promise<?{data: object, grants: {unique: {id: string, restrictions: string[]}[], talents: string[]}}>}
 */
export async function racialItemFrom(trait) {
  const chosen = [];
  const own = await answered(trait, chosen);
  if (own === null) return null;
  const scripts = [own];
  const texts = [];
  const unique = listOf(trait.grantsUnique).map(id => ({ id, restrictions: listOf(trait.uniqueRestrictions) }));
  const talents = listOf(trait.grantsTalent);

  const options = racialOptionsOf(trait.id);
  if (options.length) {
    const picked = await askOptions(trait, options);
    if (!picked) return null;
    for (const id of picked) {
      const option = options.find(entry => entry.id === id);
      chosen.push({ key: "option", value: option.id, label: option.name });
      const script = await answered(option, chosen);
      if (script === null) return null;
      scripts.push(`#@ option ${option.id} | ${option.name}\n${script}\n#@ end`);
      texts.push(`${option.name}: ${String(option.text ?? "").trim()}`);
      unique.push(...listOf(option.grantsUnique).map(each => ({ id: each, restrictions: listOf(option.uniqueRestrictions),
        option: option.id })));
      talents.push(...listOf(option.grantsTalent));
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
        race: trait.owner ?? "",
        category: String(trait.category ?? ""),
        importance: trait.subrace ? "primary" : String(trait.importance ?? ""),
        subrace: String(trait.subrace ?? ""),
        chosen
      }
    },
    grants: { unique, talents }
  };
}

/**
 * Add a Racial Trait to a character: its Item, and what it gives - each Unique Ability free and without its
 * Requirements, marked as given by it so it goes with it; each Talent, kept if it is ever lost. One already held is not
 * given twice; a Talent or Unique Ability not written yet is named.
 */
export async function addRacialTrait(actor, trait) {
  const made = await racialItemFrom(trait);
  if (!made) return null;
  const [item] = await actor.createEmbeddedDocuments("Item", [made.data]);
  if (!item) return null;
  await giveGrants(actor, item, made.grants, trait.name);
  await automateAll(actor, item);
  return item;
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
      ui.notifications.info(`${actor.name} already has ${definition.name}.`);
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
    data.flags = { ...(data.flags ?? {}), "dbu-ttrpg": { ...(data.flags?.["dbu-ttrpg"] ?? {}), grantedBy: item.id,
      ...(grant.option ? { grantedByOption: grant.option } : {}) } };
    created.push(data);
    held.add(definition.id);
  }

  const { talentItemFrom } = await import("./talents.mjs");
  const talentsHeld = new Set(Array.from(actor.items).filter(each => each.type === "talent")
    .map(each => each.flags?.["dbu-ttrpg"]?.sourceId));
  for (const id of grants.talents) {
    const talent = getTrait(id);
    if (!talent || (talent.kind !== "talents")) {
      ui.notifications.warn(`${name}: the ${id} Talent is not written yet - add it by hand once it is.`);
      continue;
    }
    if (talentsHeld.has(id)) continue;
    created.push(talentItemFrom(talent));
  }
  if (created.length) await actor.createEmbeddedDocuments("Item", created);
}

/**
 * The Triggered effects of a Racial Trait Item that the Traits tab toggles between Triggered and Automatic - not those a
 * window offers as they happen, nor those that cost Actions (a moment's card takes and pays for them) - as block ids.
 */
export async function toggledBlocks(item) {
  const { compile } = await import("./effects/parser.mjs");
  const { WINDOW_MOMENTS, momentOf } = await import("./effects/registry.mjs");
  return (compile(item?.system?.script ?? "").program?.blocks ?? [])
    .filter(block => (block.mode === "triggered") && !block.budget?.actions && !WINDOW_MOMENTS.includes(momentOf(block)))
    .map(block => `${item.id}#${block.index}`);
}

/** Gained - or its Option changed - its toggles start Automatic (the user's). */
async function automateAll(actor, item) {
  const ids = await toggledBlocks(item);
  if (!actor || !ids.length) return;
  await actor.setFlag("dbu-ttrpg", "automatic", [...new Set([...(actor.getFlag("dbu-ttrpg", "automatic") ?? []), ...ids])]);
}

/** The Option chosen on a Racial Trait Item, where it has an Option effect of one - its id, or "". */
export function racialOptionOf(item) {
  return (item?.system?.chosen ?? []).find(entry => entry.key === "option")?.value ?? "";
}

/**
 * Another Option for a Racial Trait already had (the user's: "que igual te permita cambiarlo"): its script in place of the
 * old one's between the `#@ option` markers, its choice asked, what was recorded and its wording changed with it; the
 * Unique Abilities the old Option gave go, the new one's are given - Talents given are kept, as on losing the Trait.
 */
export async function changeRacialOption(item, optionId) {
  const actor = item?.actor;
  const sourceId = item?.flags?.["dbu-ttrpg"]?.sourceId ?? "";
  const options = racialOptionsOf(sourceId);
  const option = options.find(entry => entry.id === optionId);
  if (!option || (racialOptionOf(item) === optionId)) return false;

  const extra = [];
  const script = await answered(option, extra);
  if (script === null) return false;
  const chosen = [...(item.system.chosen ?? []).filter(entry => (entry.key !== "option")
    && !options.some(each => each.id === entry.key)), { key: "option", value: option.id, label: option.name }, ...extra];
  const kept = String(item.system.script ?? "").replace(/\n*#@ option [^\n]*\n[\s\S]*?\n#@ end/g, "").trimEnd();
  await item.update({
    "system.script": `${kept}\n\n#@ option ${option.id} | ${option.name}\n${script}\n#@ end`,
    "system.chosen": chosen
  });

  if (!actor) return true;
  await automateAll(actor, item);
  const old = Array.from(actor.items).filter(each => (each.flags?.["dbu-ttrpg"]?.grantedBy === item.id)
    && each.flags?.["dbu-ttrpg"]?.grantedByOption).map(each => each.id);
  if (old.length) await actor.deleteEmbeddedDocuments("Item", old);
  await giveGrants(actor, item, {
    unique: listOf(option.grantsUnique).map(id => ({ id, restrictions: listOf(option.uniqueRestrictions), option: option.id })),
    talents: listOf(option.grantsTalent)
  }, option.name);
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
  Hooks.on("deleteItem", async (item, options, userId) => {
    if ((item.type !== RACIAL_TYPE) || !item.parent || (userId !== game.user.id)) return;
    const given = Array.from(item.parent.items).filter(each => each.flags?.["dbu-ttrpg"]?.grantedBy === item.id)
      .map(each => each.id);
    if (given.length) await item.parent.deleteEmbeddedDocuments("Item", given);
  });
}
