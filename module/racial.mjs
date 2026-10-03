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
 *   options: 1                      an Option effect: choose that many of its Options when it is added
 *   choose: knowledge               a choice its script reads as `$choice` - Knowledge (any) or an Elemental Profile
 *   grantsUnique: <ids>             Unique Abilities it gives - "You do not need to meet the Requirements to use these
 *                                   Unique Abilities and you do not need to spend any Technique Points to gain them"
 *   uniqueRestrictions: <ids>       Restrictions those come with - God of Time's Straining and Difficult Time Freeze
 *   grantsTalent: <ids>             Talents it gives - kept if the Trait is lost ("you do not lose that Talent")
 *
 * An Option is a file of its own beside it, `traits/races/<race>/<trait>/<option>.dbu`, marked `optionOf: <trait>`; its
 * script is added to the Trait's between `#@ option` markers, and it may say `choose`, `grantsUnique`, `grantsTalent`.
 */

import { getTrait, traitsOfKind } from "./effects/traits.mjs";
import { getRace, subraceName } from "./races.mjs";

/** The Item type a Racial Trait is. */
export const RACIAL_TYPE = "racial";

/** A list header - `a, b` or a single value - as a list. */
const listOf = raw => [].concat(raw ?? []).flatMap(entry => String(entry).split(",")).map(id => id.trim()).filter(Boolean);

/** Every Racial Trait there is to take - its Options are not. */
export function racialTraitFiles() {
  return traitsOfKind("races").filter(trait => !trait.optionOf);
}

/** A Racial Trait's Options, in name order. */
export function racialOptionsOf(id) {
  return traitsOfKind("races").filter(trait => trait.optionOf === id);
}

/** A race's display name, from its id. */
export function raceName(id) {
  return getRace(id)?.name ?? id ?? "";
}

/**
 * Every Racial Trait there is, in the order the picker and the list show them: this character's race first, then every
 * other race by the race's name (not the Trait's), each race's Traits by name.
 */
export function racialTraitsInOrder(race, traits = racialTraitFiles()) {
  return traits.slice().sort((a, b) =>
    (Number(b.owner === race) - Number(a.owner === race))
    || raceName(a.owner).localeCompare(raceName(b.owner))
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

/** The Racial Trait Items a character has: own race's first, then by race name, then by name. */
export function ownedRacialTraits(actor) {
  const race = actor?.system?.race;
  return Array.from(actor?.items ?? []).filter(item => item.type === RACIAL_TYPE).sort((a, b) =>
    (Number(b.system.race === race) - Number(a.system.race === race))
    || raceName(a.system.race).localeCompare(raceName(b.system.race))
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
      <label class="dbu-respond-option" data-tooltip="${escape(option.text ?? option.description ?? "")}">
        <input type="${type}" name="option" value="${escape(option.id)}" ${(index === 0) && (count === 1) ? "checked" : ""}/>
        <span class="dbu-respond-name">${escape(option.name)}</span>
        <span class="dbu-respond-source">${escape(option.description ?? "")}</span></label>`).join("")}`,
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
      unique.push(...listOf(option.grantsUnique).map(each => ({ id: each, restrictions: listOf(option.uniqueRestrictions) })));
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
        addendum: texts.join("\n"),
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

  const { uniqueItemFrom, isUniqueAbility } = await import("./unique.mjs");
  const held = new Set(Array.from(actor.items).filter(isUniqueAbility).map(each => each.system.unique?.libraryId));
  const created = [];
  for (const grant of made.grants.unique) {
    const definition = getTrait(grant.id);
    if (!definition || (definition.kind !== "unique") || definition.owner) {
      ui.notifications.warn(`${trait.name}: the ${grant.id} Unique Ability is not written yet.`);
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
    data.flags = { ...(data.flags ?? {}), "dbu-ttrpg": { ...(data.flags?.["dbu-ttrpg"] ?? {}), grantedBy: item.id } };
    created.push(data);
    held.add(definition.id);
  }

  const { talentItemFrom } = await import("./talents.mjs");
  const talentsHeld = new Set(Array.from(actor.items).filter(each => each.type === "talent")
    .map(each => each.flags?.["dbu-ttrpg"]?.sourceId));
  for (const id of made.grants.talents) {
    const talent = getTrait(id);
    if (!talent || (talent.kind !== "talents")) {
      ui.notifications.warn(`${trait.name}: the ${id} Talent is not written yet - add it by hand once it is.`);
      continue;
    }
    if (talentsHeld.has(id)) continue;
    created.push(talentItemFrom(talent));
  }
  if (created.length) await actor.createEmbeddedDocuments("Item", created);
  return item;
}

/**
 * A Racial Trait taken off: "If you lose a Racial Trait, through any means, you no longer benefit from its effects" -
 * the Unique Abilities it gave go with it; "if those effects grant you a Talent ... you do not lose that Talent".
 */
export async function removeRacialTrait(actor, itemId) {
  const given = Array.from(actor.items).filter(each => each.flags?.["dbu-ttrpg"]?.grantedBy === itemId).map(each => each.id);
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
