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

/**
 * The sizes a file offers, each with the dice for its charges, in the order written.
 *
 * Written `Small=1d4, Standard=1d6` - a name and the dice for it.
 */
export function sizesOf(definition) {
  const raw = definition?.sizes;
  const list = Array.isArray(raw) ? raw : String(raw ?? "").split(",");
  return list.map(entry => String(entry).trim()).filter(entry => entry.includes("="))
    .map(entry => {
      const [label, dice] = entry.split("=").map(part => part.trim());
      return { label, dice };
    })
    .filter(size => size.label && /^\d+d\d+$/.test(size.dice));
}

/**
 * The Combat Conditions a full restore takes off a character: every one held, but those it
 * keeps. Marks this system files beside them are not Combat Conditions and are not touched.
 *
 * A Senzu Bean: "removes all Combat Conditions (except Pinned or Suffocating)".
 *
 * @param {object} held        the character's `system.conditions`
 * @param {object[]} conditions every Condition definition, as `allConditions()` gives them
 */
export function conditionsRestored(held, conditions, keeps = []) {
  const combat = new Set(conditions.filter(condition => condition.combatCondition)
    .map(condition => condition.key));
  return Object.entries(held ?? {})
    .filter(([key, stacks]) => ((Number(stacks) || 0) > 0) && combat.has(key) && !keeps.includes(key))
    .map(([key]) => key);
}

/**
 * The kinds of portion a file offers, each read off its own headers: `<kind>Label`,
 * `<kind>Full` for Life and Ki to their maximum, `<kind>Dot` for Damage Over Time off,
 * `<kind>Removes` for the Conditions taken off, `<kind>Gains` for a mark put on.
 */
export function portionsOf(definition) {
  return listOf(definition?.portions).map(key => ({
    key,
    label: String(definition[`${key}Label`] ?? key),
    count: 0,
    full: definition[`${key}Full`] === true,
    dot: definition[`${key}Dot`] === true,
    removes: listOf(definition[`${key}Removes`]),
    gains: String(definition[`${key}Gains`] ?? "").trim().toLowerCase()
  }));
}

/**
 * What eating one portion changes about a character, as the writes to make.
 *
 * Revive: Life and Ki to their maximum. Achichi: Damage Over Time off, every stack, and its
 * clocks with it. Zutsu and Achichi: the Conditions named, off. Beaut: a mark, gained.
 */
export function portionEffects(portion, system) {
  const update = {};
  if (portion.full) {
    update["system.life.value"] = system.life.max;
    update["system.ki.value"] = system.ki.max;
  }
  if (portion.dot) {
    update["system.dotStacks"] = 0;
    update["system.timed"] = (system.timed ?? []).filter(entry => entry.kind !== "dot");
  }
  const removes = (portion.removes ?? [])
    .filter(key => (Number(system.conditions?.[key]) || 0) > 0);
  return { update, removes, gains: portion.gains || "" };
}

/**
 * Whether an Item is giving its holder what it gives right now: a Basic Item by being
 * held, an Accessory only while it is worn - "apply benefits while equipped".
 */
export function inEffect(item) {
  if (item?.type !== "gear") return false;
  return (item.system?.itemType !== "accessory") || Boolean(item.system?.equipped);
}

/** The character's Item that gives them access to this Maneuver, if one does. */
export function gearGranting(items, maneuverId) {
  return (items ?? []).find(item => inEffect(item)
    && (item.system?.grantsManeuver === maneuverId)) ?? null;
}

/** A pool made at so many per base Tier of Power of whoever makes it. */
function chargesAtCreation(definition, actor) {
  const per = Math.max(0, Number(definition?.chargesPerBaseTier) || 0);
  return per * (actor?.system?.baseTierOfPower ?? 1);
}

/**
 * Who pays a Movement's Ki, and how much each: the Item worn that pays for Movement first,
 * as far as its charges go, and the character the rest.
 *
 * "When you would spend Ki Points through the Movement Maneuver, remove them from the
 * Jetpack instead." What it cannot cover, the character pays - by the table's ruling -
 * and only that part counts against their Capacity.
 */
export function movementPayment(items, price) {
  const store = (items ?? []).find(item => inEffect(item) && item.system?.paysMovement)
    ?? null;
  const fromStore = store ? Math.min(Math.max(0, Number(store.system.charges) || 0), price) : 0;
  return { store: fromStore > 0 ? store : null, fromStore, fromSelf: price - fromStore };
}

/** The character's Item that stores what a Power Drain takes, if they have one. */
export function drainStore(items) {
  return (items ?? []).find(item => (item.type === "gear") && item.system?.storesDrain) ?? null;
}

/**
 * Whether an Item's stored Ki may pay for this attack: made with a Foundation it names, with
 * enough stored for the whole price. All or nothing, by the table's ruling.
 */
export function canPayAttack(item, foundation, price) {
  return Boolean(item) && (price > 0)
    && (item.system?.paysAttacks ?? []).includes(foundation)
    && ((Number(item.system?.charges) || 0) >= price);
}

/**
 * Whether a character holds every ball of this one's set: Items from the same file, in a set
 * of the same size, with every number from 1 to that size among them.
 *
 * "Once you gather all of them."
 */
export function setGathered(items, item) {
  const size = Number(item?.system?.set?.size) || 0;
  if (!size) return false;
  const numbers = new Set((items ?? [])
    .filter(other => (other.system?.gearId === item.system.gearId)
      && (Number(other.system?.set?.size) === size))
    .map(other => Number(other.system.set.number)));
  for (let n = 1; n <= size; n++) if (!numbers.has(n)) return false;
  return true;
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

      // A Special Basic Item: "cannot be obtained by Crafting and can only be gained from
      // your ARC".
      special: definition.special === true,

      // Tied to a Character picked when it is given, and moving to or from them - the
      // Teleport Remote.
      assignsCharacter: definition.assignsCharacter === true,
      assigned: { uuid: "", name: "" },
      teleports: definition.teleports === true,

      // Put on somebody else and locked there - the Ki-Sealing Handcuff: what putting it on
      // costs, what taking it off with the Key costs, the Skills that sneak it onto someone
      // who has not noticed and the one they notice with, the Condition it holds on them
      // and the mark that holds it. `id` pairs it with its Key, and is set when it is given.
      lock: {
        locks: definition.locks === true,
        cost: Math.max(0, Number(definition.lockCost) || 0),
        unlockCost: Math.max(0, Number(definition.unlockCost) || 0),
        skills: listOf(definition.lockSkills),
        against: String(definition.lockAgainst ?? "").trim().toLowerCase(),
        condition: String(definition.sealCondition ?? "").trim().toLowerCase(),
        mark: String(definition.sealMark ?? "").trim().toLowerCase(),
        id: "",
        // Whether putting it on gave its wearer a stack, or found them at the most already.
        gave: false
      },
      // A Key: the lock it opens.
      keyFor: "",

      // An Attribute that may stand in for the Damage Attribute, and on what - the
      // Hologram Projector's Personality Modifier, on a Signature Technique.
      damageAttribute: {
        attribute: String(definition.damageAttribute ?? "").trim().toLowerCase(),
        when: String(definition.damageAttributeWhen ?? "").trim().toLowerCase()
      },

      // Made for one Character, who may be the one holding it - the Eyeglasses'
      // "Intended Character", declared when it is given.
      declaresIntended: definition.declaresIntended === true,
      intended: { uuid: "", name: "" },

      // Worn, for an Accessory: "Accessories ... apply benefits while equipped." Given
      // unworn - putting it on is an Action.
      equipped: false,

      // Portions of several kinds, each with what eating one does - the Medibugs - and the
      // dice for how many are shared out among them.
      portionsDice: String(definition.portionsDice ?? ""),
      portions: portionsOf(definition),

      // A Maneuver holding it gives access to, and what it changes about that Maneuver - the
      // Energy-Suction Device's Power Drain: used without a Grapple, the Ki stored in it,
      // and the Foundations whose attacks the stored Ki may pay for.
      grantsManeuver: String(definition.grantsManeuver ?? "").trim().toLowerCase(),
      drainsAnywhere: definition.drainsAnywhere === true,
      storesDrain: definition.storesDrain === true,
      paysAttacks: listOf(definition.paysAttacks),

      // One of a set: how large a set may be, how large this one's is, and which of it this
      // is - a Dragon Ball - and what gathering them all costs to use.
      set: {
        min: Math.max(0, Number(definition.setMin) || 0),
        max: Math.max(0, Number(definition.setMax) || 0),
        size: 0,
        number: 0,
        actionsMin: Math.max(0, Number(definition.summonActionsMin) || 0)
      },

      // Sizes it comes in, each with the dice for its charges - the Bag of Senzu Beans'.
      sizes: sizesOf(definition),
      size: "",

      // Full Life and Ki, and every Combat Condition off but these - a Senzu Bean - and
      // whether it may be fed to a Defeated character beside you.
      restore: {
        full: definition.restoresFully === true,
        keeps: listOf(definition.restoreKeeps),
        feedsDefeated: definition.feedsDefeated === true
      },

      // Charges it is made with, rolled when it is given - the Poison Vial's Drops.
      chargesDice: String(definition.chargesDice ?? ""),
      chargesLabel: String(definition.chargesLabel ?? ""),
      // Or so many per base Tier of Power of whoever makes it, "at the time of creation" -
      // the Jetpack's 30(bT) Ki. Worked out off the character it is given to, and kept as
      // the most it holds.
      chargesPerBaseTier: Math.max(0, Number(definition.chargesPerBaseTier) || 0),
      charges: chargesAtCreation(definition, actor),
      chargesMax: chargesAtCreation(definition, actor),
      // What its charges pay for instead of the character's Ki - the Jetpack's Movement.
      paysMovement: definition.paysMovement === true,

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

      // A Light Source while it is lit and held: the mark it gives its holder, and whether
      // it is lit - the Torch.
      lightMark: String(definition.lightMark ?? "").trim().toLowerCase(),
      lit: false,

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
        // Or a Strike, answered with a Strike or a Dodge - the Taser's.
        roll: String(definition.clashRoll ?? "").trim().toLowerCase(),
        // How far it reaches: "melee" for the user's Melee Range, blank for the table's.
        reach: String(definition.clashReach ?? "").trim().toLowerCase(),
        condition: String(definition.clashCondition ?? "").trim().toLowerCase(),
        until: String(definition.clashUntil ?? "").trim().toLowerCase(),
        // A mark that keeps the Condition from coming off, on the same clock - Tased.
        hold: String(definition.clashHold ?? "").trim().toLowerCase()
      },

      // Made at a higher Craft DC for a longer reach - the Expert Taser. Chosen on the Item.
      upgrade: {
        craftDC: String(definition.upgradeCraftDC ?? ""),
        reach: Math.max(0, Number(definition.upgradeReach) || 0),
        chosen: false
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
 * one already inside a Capsule, and not an Accessory being worn - that is taken off first.
 *
 * "You can store any Basic Item into a Capsule ... You cannot store a living thing or a
 * Capsule within a Capsule."
 */
export function storable(items, capsule) {
  return (items ?? []).filter(item => (item.id !== capsule.id)
    && (item.type === "gear")
    && (GEAR_TYPES[item.system?.itemType]?.list === "basic")
    && !item.system?.capsule
    && !item.system?.equipped
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

/**
 * How many Accessories a character can wear at once.
 *
 * "Accessories are Basic Items that can be equipped and apply benefits while equipped. You
 * can only equip up to 2 Accessories at once. You can spend 1 Action to equip or remove an
 * Accessory."
 */
export const ACCESSORIES_WORN = 2;

/** What equipping or removing an Accessory costs, in Actions. */
export const EQUIP_COST = 1;

/** Whether an Item is an Accessory. */
export function isAccessory(item) {
  return (item?.type === "gear") && (item.system?.itemType === "accessory");
}

/** The Accessories a character is wearing. */
export function wornAccessories(items) {
  return (items ?? []).filter(item => isAccessory(item) && item.system?.equipped);
}

/**
 * Why an Accessory cannot be put on, or "" when it can.
 *
 * "You can only equip up to 2 Accessories at once" and "You cannot wear two of the same
 * Accessory" - the same being the same file, whatever either has been renamed to. One in a
 * Capsule is not to hand.
 */
export function equipProblem(items, item) {
  if (!isAccessory(item)) return `${item?.name ?? "That"} is not an Accessory.`;
  if (item.system.equipped) return "";
  if (isStored(items, item)) return `${item.name} is inside a Capsule.`;
  const worn = wornAccessories(items).filter(other => other.id !== item.id);
  if (worn.some(other => other.system.gearId === item.system.gearId)) {
    return `Already wearing a ${item.name}.`;
  }
  if (worn.length >= ACCESSORIES_WORN) {
    return `Already wearing ${ACCESSORIES_WORN} Accessories.`;
  }
  return "";
}

/**
 * Whether an Item is locked on whoever wears it - a Ki-Sealing Handcuff put on: "While
 * wearing this Accessory, you cannot remove this Accessory."
 */
export function lockedOn(item) {
  return Boolean(item?.system?.lock?.locks && item.system.equipped);
}

/**
 * The Item locked on this character that a Key opens - "the correct Key": the one made
 * with that instance, and no other.
 */
export function lockedBy(items, key) {
  const fits = key?.system?.keyFor;
  if (!fits) return null;
  return (items ?? []).find(item => lockedOn(item) && (item.system.lock.id === fits)) ?? null;
}

/**
 * A Key for a locking Item, made with it: "When this Accessory is created, you must create
 * a Key Basic Item for this instance of the Accessory."
 */
export function keyItemFor(lockName, lockId) {
  return {
    name: `Key (${lockName})`,
    type: "gear",
    img: GEAR_ICON,
    system: { gearId: "", itemType: "basic", keyFor: lockId,
      description: `<p>Opens the ${lockName} it was made with.</p>` }
  };
}

/**
 * A character's Conditions with a lock's hold put on or taken off: a stack of its
 * Condition and the mark that holds it, together, in one write.
 *
 * On, the stack is added to whatever they had, up to the most there can be. Off, that
 * stack comes off with the mark - "while you're wearing this Accessory" is as long as it
 * lasts.
 */
export function sealedConditions(conditions, lock, on, maxStacks = Infinity) {
  const next = { ...(conditions ?? {}) };
  const had = Number(next[lock.condition]) || 0;
  if (on) {
    if (lock.condition) next[lock.condition] = Math.min(maxStacks, had + 1);
    if (lock.mark) next[lock.mark] = 1;
    return next;
  }
  if (lock.mark) delete next[lock.mark];
  // Only the stack it gave: one they already had at the most there can be was theirs, and
  // stays theirs when it comes off.
  if (lock.condition && (lock.gave !== false)) {
    if (had > 1) next[lock.condition] = had - 1;
    else delete next[lock.condition];
  }
  return next;
}

/**
 * What may stand in for the Damage Attribute of this attack: the worn Accessories that
 * offer an Attribute for it, one per Attribute.
 *
 * "When using the Signature Technique Maneuver, you may use your Personality Modifier for
 * the Damage Attribute of that Attacking Maneuver." `when: signature` is that - an attack
 * made through the Signature Technique Maneuver, which marks what it makes `signature`.
 */
export function damageAttributeOffers(items, maneuver) {
  const offers = [];
  for (const item of accessoriesInEffect(items)) {
    const { attribute, when } = item.system.damageAttribute ?? {};
    if (!attribute) continue;
    if ((when === "signature") && !maneuver?.signature) continue;
    if (offers.some(offer => offer.attribute === attribute)) continue;
    offers.push({ attribute, source: item.name });
  }
  return offers;
}

/**
 * The Accessories whose effects apply: the ones worn, one of each.
 *
 * "... nor benefit from the same Accessory's effects twice (even if it was Integrated)."
 * Two of the same cannot be worn, so the one-of-each here is for the other way there could
 * be two - Integrated, which arrives with the rules that name it. Whatever reads an
 * Accessory's effects reads them from here.
 */
export function accessoriesInEffect(items) {
  const seen = new Set();
  return wornAccessories(items).filter(item => {
    const key = item.system.gearId || item.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
