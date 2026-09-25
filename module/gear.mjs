/**
 * Gear, which is the rulebook's Equipment.
 *
 * "There are four Item Types in DBU: Basic Item, Accessory, Apparel, and Weapon." Each
 * Item a character has is an Item document of the `gear` type, copied from a file in
 * traits/gear/ the way a Maneuver is copied from traits/maneuvers/ - so it can be renamed
 * and re-described on the character without touching the file, and the file's entry is
 * still there to read.
 *
 * A character does not have every Item there is: they are given one when they gain it,
 * through the Add Item window on the Gear tab. How they came by it - the Gear Kit, its
 * Equipment Points, a find, a gift - is between the player and the ARC, and nothing here
 * keeps count of it.
 */

/**
 * The four Item Types, and which list on the Gear tab each is drawn in.
 *
 * Accessories share the Basic Items' list: "Accessories are also counted as Basic Items
 * for rules and effects".
 */
export const GEAR_TYPES = Object.freeze({
  basic: { label: "Basic Item", list: "basic" },
  accessory: { label: "Accessory", list: "basic" },
  apparel: { label: "Apparel", list: "apparel" },
  weapon: { label: "Weapon", list: "weapon" }
});

/**
 * The tags a Basic Item can carry after its name.
 *
 * "Any Basic Item that has the [Tech] tag after its name is Technology." [Med] is
 * medicine, made with a Medicine Skill Check of the Craft DC, and [Food] is food, made
 * with a Cooking one.
 */
export const GEAR_TAGS = Object.freeze({
  tech: { label: "Tech" },
  med: { label: "Med", craftSkill: "medicine" },
  food: { label: "Food", craftSkill: "cooking" }
});

/** Foundry's own bag, until an Item brings a picture of its own. */
export const GEAR_ICON = "icons/svg/item-bag.svg";

/**
 * The folders under traits/gear/, one per list on the Gear tab, and the Item Types each
 * may hold - the first being what a file in it is when its header does not say.
 *
 * So the folder is what decides the list, and `itemType:` is only needed to tell an
 * Accessory from a Basic Item.
 */
export const GEAR_FOLDERS = Object.freeze({
  basic: ["basic", "accessory"],
  apparel: ["apparel"],
  weapons: ["weapon"]
});

/**
 * Which of the four Item Types a file is.
 *
 * What its header says, where that is a type its folder holds; the folder's own type
 * otherwise. A file outside the three folders is whatever its header says, or a Basic
 * Item.
 */
export function typeOf(definition) {
  const allowed = GEAR_FOLDERS[definition?.owner] ?? Object.keys(GEAR_TYPES);
  const said = String(definition?.itemType ?? "").trim().toLowerCase();
  return allowed.includes(said) ? said : allowed[0];
}

/**
 * The tags a file gives its Item, in the order written.
 *
 * A header with one value comes back from the parser as a string and one with several as a
 * list, so both are read. Only the tags the rules name are kept.
 */
export function tagsOf(definition) {
  const raw = definition?.tags;
  const list = Array.isArray(raw) ? raw : String(raw ?? "").split(",");
  return list.map(tag => String(tag).trim().toLowerCase()).filter(tag => GEAR_TAGS[tag]);
}

/** The files for one list on the Gear tab, by name. */
export function gearOfList(definitions, list) {
  return (definitions ?? [])
    .filter(definition => GEAR_TYPES[typeOf(definition)].list === list)
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

/**
 * The Item a character is given from a file.
 *
 * The description starts empty: it is the player's, for whatever this one is to them. The
 * rulebook's entry is kept as `text` and shown beside it, read from the file where the
 * file still exists.
 */
export function gearItemFrom(definition) {
  return {
    name: definition.name,
    type: "gear",
    img: GEAR_ICON,
    flags: { "dbu-ttrpg": { sourceId: definition.id } },
    system: {
      gearId: definition.id,
      itemType: typeOf(definition),
      tags: tagsOf(definition),
      craftDC: String(definition.craftDC ?? ""),
      text: String(definition.text ?? ""),
      source: String(definition.source ?? ""),
      description: ""
    }
  };
}
