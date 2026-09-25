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

/**
 * What can set off an Item that goes off - the Bomb's three, as its entry names them.
 *
 * `row` is whether the Item's own row offers to set it off. A Timed one is not set off by
 * hand: its Rounds are counted, and the Round's card offers it when they have passed. A
 * Remote Controlled one is set off from the Remote Control connected to it: "You can
 * trigger this Bomb using a Remote Control Basic Item."
 */
export const GEAR_TRIGGERS = Object.freeze({
  remote: { label: "Remote Controlled", row: false },
  timed: { label: "Timed", row: false },
  proximity: { label: "Proximity", row: true }
});

/** A list header, from one value or several. */
function listOf(raw) {
  const list = Array.isArray(raw) ? raw : String(raw ?? "").split(",");
  return list.map(entry => String(entry).trim().toLowerCase()).filter(Boolean);
}

/** The triggers a file offers, in the order written, and only the ones there are. */
export function triggersOf(definition) {
  return listOf(definition?.triggers).filter(trigger => GEAR_TRIGGERS[trigger]);
}

/**
 * The modifier an Item records from whoever makes it, or null if it records none.
 *
 * The Bomb: "When you create this Basic Item, record your Scholarship Modifier."
 */
export function recordedFrom(definition, actor) {
  const attribute = String(definition?.records ?? "").trim().toLowerCase();
  if (!attribute) return null;
  const modifier = actor?.system?.attributes?.[attribute]?.mod;
  return Number.isFinite(Number(modifier)) ? Number(modifier) : 0;
}

/**
 * The placed, Timed Items whose Rounds have now passed, and every placed Timed one's count
 * one Round lower.
 *
 * "This Bomb will trigger once that number of Combat Rounds have passed." Counted at the
 * start of each Combat Round: placed with three, it goes off at the start of the third
 * Round after. Held at zero once it gets there, until it is set off.
 *
 * @param {{system: object}[]} items the character's Gear
 * @returns {{updates: object[], due: object[]}} the writes to make, and the Items now due
 */
export function tickCountdowns(items) {
  const updates = [];
  const due = [];
  for (const item of items ?? []) {
    const system = item.system ?? {};
    if (!system.placed || (system.trigger !== "timed")) continue;
    const left = Math.max(0, (Number(system.countdown) || 0) - 1);
    if (left !== system.countdown) updates.push({ _id: item.id, "system.countdown": left });
    if (left === 0) due.push(item);
  }
  return { updates, due };
}

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
  return listOf(definition?.tags).filter(tag => GEAR_TAGS[tag]);
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
export function gearItemFrom(definition, actor = null) {
  const triggers = triggersOf(definition);
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
      description: "",

      // What an Item that records something from its maker, and goes off, needs to keep.
      // Copied rather than read from the file each time, as everything else here is: the
      // Item is the character's, and the file may change under it.
      records: String(definition.records ?? "").trim().toLowerCase(),
      recorded: recordedFrom(definition, actor),
      triggers,
      trigger: triggers[0] ?? "",
      placeCost: Math.max(0, Number(definition.placeCost) || 0),
      placed: false,
      countdown: 0,
      detonation: {
        profile: String(definition.detonationProfile ?? ""),
        foundation: String(definition.detonationFoundation ?? ""),
        autoHit: definition.detonationAutoHit === true
      },

      // Charges it is made with, rolled when it is given - the Poison Vial's Drops.
      chargesDice: String(definition.chargesDice ?? ""),
      chargesLabel: String(definition.chargesLabel ?? ""),
      charges: 0,

      // A mark it leaves on everyone in the area it bursts in, and whether it lasts to the
      // start or the end of the thrower's next turn - the Smoke Bomb's Smoked.
      areaMark: {
        condition: String(definition.areaMark ?? "").trim().toLowerCase(),
        until: String(definition.areaUntil ?? "").trim().toLowerCase()
      },

      // A scan, and the Check that hides from it - the Scout Scope's Qualified Concealment.
      scan: {
        skill: String(definition.scanSkill ?? "").trim().toLowerCase(),
        difficulty: String(definition.scanDifficulty ?? "").trim().toLowerCase()
      },

      // What it can be connected to, and what it is - the Remote Control's Item.
      connects: listOf(definition.connects),
      connectedTo: "",

      // A Capsule: it holds one Basic Item. Which one is on that Item, as `storedIn`.
      capsule: definition.capsule === true,
      storedIn: "",

      // A Clash it makes against whoever it catches, and what winning leaves on them -
      // the Flash Bang's Clash (Impulsive), and Blinded until the start of your next turn.
      clash: {
        save: String(definition.clashSave ?? "").trim().toLowerCase(),
        condition: String(definition.clashCondition ?? "").trim().toLowerCase(),
        until: String(definition.clashUntil ?? "").trim().toLowerCase()
      },

      // An Item thrown to catch someone - the Net: the Foundations its Strike may be made
      // with, the mark winning the Strike leaves, and the Condition winning the Might Clash
      // after it does.
      snare: {
        foundations: listOf(definition.snareFoundations),
        mark: String(definition.snareMark ?? "").trim().toLowerCase(),
        condition: String(definition.snareCondition ?? "").trim().toLowerCase()
      },

      // An Item used up to take Conditions off, or to heal - the Longevity Supplement,
      // Medicine.
      removes: listOf(definition.removes),
      heal: {
        dice: String(definition.healDice ?? ""),
        scale: String(definition.healScale ?? ""),
        // Ki Points as well as Life, each rolled for - the Snack's "Life and Ki Points".
        ki: definition.healKi === true
      },
      oncePerEncounter: definition.oncePerEncounter === true,
      consumed: definition.consumed === true,

      // What an Item left on the ground does to whoever moves through it - Caltrops.
      hazard: {
        dice: String(definition.hazardDice ?? ""),
        scale: String(definition.hazardScale ?? ""),
        sparesAirborne: definition.hazardSparesAirborne === true
      }
    }
  };
}

/**
 * The entry a once-per-Encounter Item leaves among the character's used effects.
 *
 * Kept with the other once-per-Encounter uses, in `usedManeuvers`, which is cleared when an
 * Encounter begins and when it ends. Keyed by the file rather than the Item, so a second
 * copy of the same Item is still the same Item used again.
 */
export function encounterUseKey(item) {
  return `encounter:gear.${item.system?.gearId || item.id}`;
}

/** Whether this character has already used this Item this Combat Encounter. */
export function usedThisEncounter(actor, item) {
  return (actor?.system?.usedManeuvers ?? []).includes(encounterUseKey(item));
}

/**
 * The entry a character hidden from a scanning Item leaves among their once-per-Encounter
 * uses, with the Holding Back stacks they had when they hid.
 *
 * The Scout Scope: "they automatically succeed on any further Concealment Skill Checks to
 * avoid being spotted by a Scout Scope for the remainder of the Combat Encounter. If their
 * number of Holding Back stacks would decrease below their current number, they lose this
 * benefit." Kept in `usedManeuvers`, which clears when an Encounter begins and ends.
 */
export function hiddenKey(gearId, stacks) {
  return `encounter:gear.${gearId}.hidden.${Math.max(0, Number(stacks) || 0)}`;
}

/** The Holding Back stacks a character has. */
export function holdingBackStacks(actor) {
  return Number(actor?.system?.resources?.holdingback?.stacks) || 0;
}

/**
 * Whether a character is still hidden from this kind of scanning Item: they hid this
 * Encounter, and their Holding Back stacks have not dropped below what they had then.
 */
export function stillHidden(actor, gearId) {
  const prefix = `encounter:gear.${gearId}.hidden.`;
  const entry = (actor?.system?.usedManeuvers ?? []).find(used => used.startsWith(prefix));
  if (!entry) return false;
  return holdingBackStacks(actor) >= (Number(entry.slice(prefix.length)) || 0);
}

/**
 * What a scan reads: the current Tier of Power, and the Power Level only when that Tier is
 * the base one. "If their current Tier of Power is the same as their base Tier of Power, you
 * also learn of their Power Level."
 */
export function scanReading(actor) {
  const system = actor?.system ?? {};
  const tier = system.tierOfPower ?? 1;
  const atBase = tier === (system.baseTierOfPower ?? 1);
  return { tier, powerLevel: atBase ? (system.powerLevel ?? null) : null };
}

/**
 * What a Remote Control can be connected to among a character's Items: their own Items made
 * from one of the files it names.
 *
 * "Select an Item (Bomb/Collar/Vehicle/Battle Jacket) you possess for it to be connected to."
 */
export function connectable(items, remote) {
  const kinds = remote.system?.connects ?? [];
  return (items ?? []).filter(item => (item.id !== remote.id)
    && kinds.includes(item.system?.gearId));
}

/** The Item a Remote Control is connected to, if the character still has it. */
export function connectedItem(items, remote) {
  const id = remote.system?.connectedTo;
  return id ? ((items ?? []).find(item => item.id === id) ?? null) : null;
}

/**
 * Whether a Remote Control can set off what it is connected to now: a Bomb, placed, set to
 * be Remote Controlled.
 */
export function canTrigger(target) {
  return Boolean(target?.system?.placed) && (target.system.trigger === "remote")
    && Boolean(target.system.detonation?.profile);
}

/**
 * The Item a Capsule holds, among a character's Items, or null.
 *
 * Found by the mark on the held Item rather than kept on the Capsule: the held Item stays an
 * Item of the character's, so it can be read, renamed and thrown out whole.
 */
export function heldBy(items, capsule) {
  return (items ?? []).find(item => item.system?.storedIn === capsule.id) ?? null;
}

/**
 * Whether an Item is inside a Capsule the character still has.
 *
 * A Capsule removed with something in it leaves that Item marked with a Capsule that is no
 * longer there - and an Item held by nothing is an Item in the character's hands.
 */
export function isStored(items, item) {
  const id = item.system?.storedIn;
  return Boolean(id) && (items ?? []).some(other => other.id === id);
}

/**
 * What a Capsule can take: the character's Basic Items and Accessories, not a Capsule, not
 * one already inside a Capsule.
 *
 * "You can store any Basic Item into a Capsule ... You cannot store a living thing or a
 * Capsule within a Capsule."
 */
export function storable(items, capsule) {
  return (items ?? []).filter(item => (item.id !== capsule.id)
    && (item.type === "gear")
    && (GEAR_TYPES[item.system?.itemType]?.list === "basic")
    && !item.system?.capsule
    && !isStored(items, item));
}

/**
 * Dice an Item rolls, scaled by a character's Tier.
 *
 * "1d4(bT)" is a d4 per base Tier of Power - the count multiplies and the die does not,
 * which is how every Tier-scaled roll here reads. The character is the one the dice are
 * about: whoever moves through Caltrops, whoever takes Medicine.
 */
export function tierDice(spec, actor) {
  const [count, faces] = String(spec?.dice ?? "").split("d");
  const n = Number(count) || 0;
  if (!n || !faces) return "";
  const system = actor?.system ?? {};
  const multiplier = (spec.scale === "T") ? (system.tierOfPower ?? 1)
    : (spec.scale === "bT") ? (system.baseTierOfPower ?? 1)
    : 1;
  const total = n * Math.max(1, multiplier);
  return `${total}d${faces}`;
}

/**
 * The dice an Item left on the ground rolls against whoever moves through it - theirs, the
 * one suffering it.
 */
export function hazardFormula(hazard, victim) {
  return tierDice(hazard, victim);
}
