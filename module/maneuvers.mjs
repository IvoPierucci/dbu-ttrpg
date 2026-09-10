import { applySlot } from "./effects/interpreter.mjs";
import { traitsOfKind } from "./effects/traits.mjs";

/**
 * Maneuvers: anything that spends an Action.
 *
 * Every Maneuver carries an Action Cost (which type of Action, and how many) and a
 * Ki Point cost, and some may only be used a limited number of times per Combat
 * Round or per Combat Encounter - written in their name as [x/Round] or
 * [x/Encounter].
 *
 * Nothing consumes this yet; it is the shared vocabulary the combat rules are built
 * on, kept in one place so the timing rules are stated once rather than restated at
 * each call site.
 *
 * @typedef {object} ManeuverDefinition
 * @property {string} name
 * @property {keyof MANEUVER_TYPES} type
 * @property {number} actionCost   How many Actions of the type's Action are spent.
 * @property {number} kiCost       Ki Points spent to use it.
 * @property {boolean} attacking  Whether it is an Attack, which is what Counter
 *                                Maneuvers may be used in response to.
 * @property {string} source      Where the Maneuver comes from - "Core Rule" for the
 *                                ones everyone has, and later a Talent, race or
 *                                Transformation for the rest.
 * @property {?{amount: number, per: "round"|"encounter"}} usageLimit
 * @property {boolean} requiresTarget  Whether a token must be targeted to use it.
 * @property {?{skill: string}} clash  Makes this a Skill Clash: both sides roll the
 *                                     named Skill and the higher total wins.
 * @property {?string} profile     Attack Profile, for an attacking Maneuver: a
 *                                 Profile id, or "any" to choose freely. Its
 *                                 Foundation is chosen when the attack is declared.
 */

/**
 * The four types of Maneuver. `action` names the Action a Maneuver of that type
 * spends; the types that resolve outside the Action economy spend none.
 */
export const MANEUVER_TYPES = Object.freeze({
  standard: {
    label: "Standard",
    action: "standard",
    /** Only on your own turn. */
    ownTurnOnly: true,
    /**
     * The default: a Maneuver is Standard unless it says otherwise.
     */
    isDefault: true
  },

  counter: {
    label: "Counter",
    action: "counter",
    ownTurnOnly: false,
    /**
     * Defensive. Unusable unless you are the target of an Attacking Maneuver, unless
     * the Maneuver itself says otherwise.
     */
    requiresBeingTargeted: true
  },

  instant: {
    label: "Instant",
    action: null,
    ownTurnOnly: false,
    /**
     * Occurs on any character's turn, between Standard Maneuvers - either after one
     * or in response to one, resolving before it.
     *
     * Two restrictions that a combat tracker has to enforce, since neither is
     * visible from the Maneuver itself:
     *  - it may only respond to a Standard Maneuver, never to any other type;
     *  - it may not be used if your previous Maneuver this turn was also an Instant,
     *    including when that Instant's effects led to another Maneuver being used.
     *
     * A Maneuver used "as an Instant Maneuver" ignores its usual Action Cost.
     */
    respondsTo: ["standard"]
  },

  outOfSequence: {
    label: "Out-of-Sequence",
    action: null,
    ownTurnOnly: false,
    /**
     * Resolves the moment its effect occurs, pausing every Maneuver already in
     * progress until it finishes. Counter Maneuvers and effects may still respond to
     * it as normal.
     *
     * Only one may occur from a single trigger: two effects that both fire on the
     * same trigger are a choice between them, not both.
     *
     * A Maneuver used "as an Out-of-Sequence Maneuver" ignores its usual timing and
     * Action Cost.
     */
    onePerTrigger: true
  }
});

/**
 * Attack Profiles. A Profile belongs to one or more Foundations, and each carries an
 * effect of its own - none of which are implemented yet.
 *
 * A Profile available in several Foundations does not fix which one an attack uses:
 * the Foundation is declared alongside the Profile when the attack is made, and it
 * is what decides the Damage Attribute behind the Wound roll.
 */
/**
 * How much of the target's Soak Value stands between them and the damage. A Profile
 * declares one, and it is what makes two attacks of the same Wound land differently.
 *
 * Each is numbered, because a Damage Category is arrived at by arithmetic: every
 * effect that raises or lowers it contributes a step, they are summed, and only the
 * sum is clamped. Clamping as you go would lose the difference between a Category
 * pushed to the ceiling and one pushed well past it - a +3 answered by a -2 must land
 * on Direct, not back on Standard.
 */
export const DAMAGE_CATEGORIES = Object.freeze({
  standard: { value: 1, label: "Standard", soakMultiplier: 1, summary: "Defended against with the full Soak Value." },
  direct: { value: 2, label: "Direct", soakMultiplier: 0.5, summary: "Ignores half of the Soak Value." },
  lethal: { value: 3, label: "Lethal", soakMultiplier: 0, summary: "Ignores the Soak Value entirely." }
});

const DAMAGE_CATEGORY_MIN = 1;
const DAMAGE_CATEGORY_MAX = 3;

/**
 * The Damage Category an attack ends up at: its Profile's, moved by the total of every
 * step for and against it, and only then held within range.
 */
export function resolveDamageCategory(baseCategory, shift = 0) {
  const base = DAMAGE_CATEGORIES[baseCategory]?.value ?? DAMAGE_CATEGORY_MIN;
  const value = Math.min(DAMAGE_CATEGORY_MAX, Math.max(DAMAGE_CATEGORY_MIN, base + shift));
  return Object.keys(DAMAGE_CATEGORIES).find(key => DAMAGE_CATEGORIES[key].value === value);
}

export const PROFILES = Object.freeze({
  simple: {
    label: "Simple",
    foundations: ["physical", "energy", "magic"],
    /** Added to the Maneuver's own cost: a Profile is what an attack pays for. */
    kiCost: 0,
    damageCategory: "standard"
  }
});

/**
 * The effects the Defend Maneuver can be used for. Each is chosen when the Maneuver
 * is played, and each carries its own Ki Point cost - which is why the Maneuver's own
 * cost is listed as varying.
 *
 * `kiCostPerBaseTier` is the "8(bT)" notation: the cost is that much per Base Tier of
 * Power, so it grows with the character rather than staying flat.
 */
export const DEFEND_OPTIONS = Object.freeze({
  parry: {
    label: "Parry",
    kiCost: 0,
    summary: "Clash with your Strike Roll instead of your Dodge Roll. Win and you avoid "
      + "the attack. Each Energy Charge on it takes 1(bT) off your roll."
  },
  directHit: {
    label: "Direct Hit",
    kiCost: 0,
    summary: "Forgo the clash and be hit, with your Soak Value increased by half for "
      + "this attack. Shrug off a charged or heavily wagered blow for nothing and the "
      + "attacker is left Shaken."
  },
  powerFlare: {
    label: "Power Flare",
    kiCost: 0,
    // The only option whose own Wound Roll is made, so the only one that can wager.
    allowsKiWager: true,
    summary: "Be hit automatically, then answer their Wound Roll with your own, as an "
      + "Energy or Magic Attack. Beat it and take no damage."
  },
  crossCounter: {
    label: "Cross Counter",
    kiCost: 0,
    summary: "Clash with your Defense Value halved, then strike back with a Basic Attack out of sequence."
  },
  guard: {
    label: "Guard",
    /** Each Energy Charge on the attack adds this much per Base Tier, up to `max`. */
    chargeSurcharge: { perCharge: 1, max: 4 },
    kiCostPerBaseTier: 8,
    summary: "Forgo the clash and be hit, but halve the Wound Roll against you and "
      + "drop its Damage Category by one. Each Energy Charge on the attack adds "
      + "1(bT) to what this costs, up to four."
  }
});

/**
 * What one Defend option costs this character, resolving the (bT) notation and any
 * Talent that discounts it. A discount can never make a Maneuver pay you.
 */
export function defendOptionCost(option, actor, attack = null) {
  const definition = DEFEND_OPTIONS[option];
  const base = definition.kiCostPerBaseTier
    ? definition.kiCostPerBaseTier * actor.system.baseTierOfPower
    : (definition.kiCost ?? 0);

  // Guard gets dearer the more the attack was charged: "+1(bT) for each Energy Charge
  // on your Opponent's Attacking Maneuver (max. +4(bT))". The cap is on the Charges
  // counted, not on the Ki - four Charges is as expensive as seven.
  const surcharge = definition.chargeSurcharge
    ? Math.min(attack?.energyCharges ?? 0, definition.chargeSurcharge.max)
      * definition.chargeSurcharge.perCharge * actor.system.baseTierOfPower
    : 0;

  // The Slot names the option, so an effect that discounts Guard cannot touch Parry.
  // The whole cost goes through the engine rather than a hand-rolled sum, which is
  // what makes flat and (bT) discounts work here - reading only perTier is why they
  // silently did nothing before.
  // The surcharge rides on top of whatever the option costs after any discount: an
  // effect that cheapens Guard cheapens Guard, not the Charges on the attack.
  return Math.max(0,
    applySlot(actor.system.effects?.slots, `defend.${option}.kiCost`, base) + surcharge);
}

/** Action types a Maneuver can spend. Instant and Out-of-Sequence spend none. */
export const ACTION_TYPES = Object.freeze(["standard", "counter"]);

/**
 * Spend a Maneuver's Ki Point cost, or report that the character cannot afford it.
 *
 * Action Costs are not spent: that needs a notion of the current Combat Round to
 * reset the pool against, which the system does not have yet.
 *
 * @returns {Promise<boolean>} Whether the Maneuver may proceed.
 */
export async function spendManeuverCost(actor, maneuver, costOverride = null) {
  const cost = costOverride ?? maneuver.kiCost ?? 0;
  if (cost <= 0) return true;

  const { ki, capacity } = actor.system;

  if (ki.value < cost) {
    ui.notifications.warn(`${actor.name} needs ${cost} Ki Points for ${maneuver.name} and has ${ki.value}.`);
    return false;
  }

  // Capacity caps what may be spent within one Combat Round, on top of what the
  // pool holds.
  if (cost > capacity.remaining) {
    ui.notifications.warn(
      `${actor.name} has ${capacity.remaining} Capacity left this round and ${maneuver.name} costs ${cost}.`
    );
    return false;
  }

  await actor.update({
    "system.ki.value": ki.value - cost,
    "system.capacity.spent": capacity.spent + cost
  });
  return true;
}

/** Give back the Ki Points a Maneuver cost, when it is cancelled before resolving. */
export async function refundManeuverCost(actor, maneuver) {
  const cost = maneuver.kiCost ?? 0;
  if (cost <= 0) return;

  // Never refund past the pool's maximum, or cancelling would be a way to heal Ki.
  const restored = Math.min(actor.system.ki.max, actor.system.ki.value + cost);
  await actor.update({
    "system.ki.value": restored,
    // The Capacity it used is released too, or a cancelled Maneuver would still
    // count against what may be spent this round.
    "system.capacity.spent": Math.max(0, actor.system.capacity.spent - cost)
  });
}

/** One-question dialog returning the chosen action, or null if dismissed. */
async function pick(title, question, buttons) {
  const chosen = await foundry.applications.api.DialogV2.wait({
    classes: ["dbu-dialog"],
    window: { title },
    content: `<p>${question}</p>`,
    buttons: [...buttons, { action: "cancel", label: "Cancel" }],
    rejectClose: false
  });
  return (chosen && (chosen !== "cancel")) ? chosen : null;
}

/**
 * Group the Profiles the way they are chosen: those offered in more than one
 * Foundation come first, since picking one leaves the Foundation still to declare,
 * and the rest sit under the single Foundation they belong to.
 *
 * The per-Foundation groups are empty for now - Simple is the only Profile - but they
 * are what every Foundation-specific Profile will slot into.
 */
function profileGroups(foundations) {
  const groups = [{ key: "multi", label: "Multi-Foundation", profiles: [] }];
  for (const [key, foundation] of Object.entries(foundations)) {
    groups.push({ key, label: foundation.label, profiles: [] });
  }

  for (const [id, profile] of Object.entries(PROFILES)) {
    const group = (profile.foundations.length > 1)
      ? groups[0]
      : groups.find(candidate => candidate.key === profile.foundations[0]);
    group?.profiles.push({ id, ...profile });
  }

  return groups;
}

/**
 * Ask which Profile an attack uses and, when the Profile spans more than one, which
 * Foundation - the Foundation is what decides the Damage Attribute behind Wound.
 *
 * A Maneuver naming one Profile skips the first question, and a Profile that belongs
 * to a single Foundation answers the second on its own. Shared, because an attack has
 * to be declared the same way however it is reached - from the sheet, or out of
 * sequence.
 *
 * @returns {Promise<?{profile: string, foundation: string}>}
 */
export async function declareAttack(maneuver, foundations, actor) {
  const declared = await pickProfile(maneuver, foundations, actor);
  if (!declared) return null;

  const { profile, kiWager } = declared;
  const available = PROFILES[profile].foundations;
  const foundation = (available.length === 1)
    ? available[0]
    : await pick(
        `${maneuver.name} - ${PROFILES[profile].label} Profile`,
        "Which Foundation is this attack made with?",
        available.map(key => ({ action: key, label: foundations[key].label }))
      );
  if (!foundation) return null;

  return { profile, foundation, kiWager };
}

/**
 * Just the Profile, with no wager and no Foundation.
 *
 * The Energy Charge Maneuver declares an Attacking Maneuver before it is thrown, and
 * the Profile is settled then - "the next Basic Attack has to be with that Profile".
 * What it costs and what Foundation carries it are still the attack's own business, so
 * they are asked when it is finally made.
 *
 * @returns {Promise<string|null>} A Profile id, or null if nothing was chosen.
 */
export async function pickProfileOnly(maneuver, foundations, hint = "") {
  if (maneuver.profile && (maneuver.profile !== "any")) return maneuver.profile;

  const groups = profileGroups(foundations);
  let checked = false;

  const sections = groups.map(group => {
    if (!group.profiles.length) return "";
    const items = group.profiles.map(profile => {
      const attr = checked ? "" : "checked";
      checked = true;
      return `<label class="dbu-profile-option">
        <input type="radio" name="profile" value="${profile.id}" ${attr}/>
        <span class="dbu-profile-name">${Handlebars.escapeExpression(profile.label)}</span>
        <span class="dbu-profile-category">${DAMAGE_CATEGORIES[profile.damageCategory].label}</span>
        <span class="dbu-profile-cost">${profile.kiCost ? `${profile.kiCost} KP` : "0 KP"}</span>
      </label>`;
    }).join("");

    return `<details class="dbu-profile-group" open>
      <summary>${Handlebars.escapeExpression(group.label)}</summary>
      ${items}
    </details>`;
  }).join("");

  const chosen = await foundry.applications.api.DialogV2.wait({
    classes: ["dbu-dialog"],
    window: { title: `${maneuver.name} - Profile` },
    content: `${hint ? `<p class="dbu-respond-hint">${hint}</p>` : ""}
      <div class="dbu-profile-picker">${sections}</div>`,
    buttons: [
      {
        action: "confirm",
        label: "Confirm",
        callback: (event, button, dialog) =>
          dialog.element.querySelector('input[name="profile"]:checked')?.value ?? null
      },
      { action: "cancel", label: "Cancel" }
    ],
    rejectClose: false
  });

  return (typeof chosen === "string") ? chosen : null;
}

/**
 * The most Ki a character may wager on one attack: half their Capacity by the rule,
 * and no more than they could actually pay for.
 */
export function maxKiWager(actor) {
  const { capacity, ki } = actor.system;
  return Math.max(0, Math.min(Math.floor(capacity.max / 2), capacity.remaining, ki.value));
}

/**
 * The least that may be wagered on an Attacking Maneuver.
 *
 * Normally nothing. Compelled is what makes it something: "you must Ki Wager at least
 * 1/10 (rounded up) of your Max Capacity on all Attacking Maneuvers against that
 * target". Held down to what can actually be paid, since a floor above the ceiling
 * would leave the dialog with no number it would accept - the rule cannot make you
 * spend Ki you do not have.
 */
export function minimumKiWager(actor) {
  const floor = applySlot(actor.system.effects?.slots, "attack.kiWager.min", 0);
  return Math.max(0, Math.min(floor, maxKiWager(actor)));
}

/**
 * Declare the attack's Profile and its Ki Wager together, since both are settled at
 * the same moment - and both are paid for at the same moment too.
 *
 * A Maneuver that names its own Profile still opens this, because the wager is asked
 * either way; it simply has nothing to choose between.
 */
async function pickProfile(maneuver, foundations, actor) {
  const groups = profileGroups(foundations);
  const fixed = (maneuver.profile !== "any") ? PROFILES[maneuver.profile] : null;
  let checked = false;

  const sections = groups.map(group => {
    if (!group.profiles.length) {
      return `<details class="dbu-profile-group dbu-profile-empty">
        <summary>${Handlebars.escapeExpression(group.label)} <em>none yet</em></summary>
      </details>`;
    }

    const items = group.profiles.map(profile => {
      // The first Profile in the first non-empty group starts selected, so confirming
      // straight away is always a valid choice.
      const attr = checked ? "" : "checked";
      checked = true;
      return `<label class="dbu-profile-option">
        <input type="radio" name="profile" value="${profile.id}" ${attr}/>
        <span class="dbu-profile-name">${Handlebars.escapeExpression(profile.label)}</span>
        <span class="dbu-profile-category">${DAMAGE_CATEGORIES[profile.damageCategory].label}</span>
        <span class="dbu-profile-cost">${profile.kiCost ? `${profile.kiCost} KP` : "0 KP"}</span>
      </label>`;
    }).join("");

    // Groups that hold something open by default; empty ones stay shut.
    return `<details class="dbu-profile-group" open>
      <summary>${Handlebars.escapeExpression(group.label)}</summary>
      ${items}
    </details>`;
  }).join("");

  const body = fixed
    ? `<p class="dbu-profile-fixed"><strong>${Handlebars.escapeExpression(fixed.label)}</strong>
        &middot; ${DAMAGE_CATEGORIES[fixed.damageCategory].label}</p>`
    : `<div class="dbu-profile-picker">${sections}</div>`;

  // Wagered Ki is added to the Wound Roll and comes out of Capacity, so the ceiling
  // is the lower of the rule's half-Capacity limit and what can actually be paid.
  // The floor is normally nothing, and is what Compelled raises.
  const wagerMax = maxKiWager(actor);
  const wagerMin = minimumKiWager(actor);
  const wager = `
    <label class="dbu-wager">
      <span>Ki Wager</span>
      <input type="number" name="kiWager" value="${wagerMin}" min="${wagerMin}" max="${wagerMax}"/>
      <em>${wagerMin ? `at least ${wagerMin}, ` : ""}max ${wagerMax}, added to the Wound Roll</em>
    </label>`;

  const chosen = await foundry.applications.api.DialogV2.wait({
    classes: ["dbu-dialog"],
    window: { title: `${maneuver.name} - Profile` },
    content: `${body}${wager}`,
    buttons: [
      {
        action: "confirm",
        label: "Confirm",
        callback: (event, button, dialog) => {
          const profile = fixed
            ? maneuver.profile
            : dialog.element.querySelector('input[name="profile"]:checked')?.value;
          if (!profile) return null;

          // Clamped here as well as on the input: `min` on a number field is advice to
          // the browser, not a guarantee, and a typed number gets through it.
          const typed = Math.floor(Number(dialog.element.querySelector('input[name="kiWager"]').value));
          const kiWager = Number.isFinite(typed)
            ? Math.min(Math.max(typed, wagerMin), wagerMax)
            : wagerMin;
          return { profile, kiWager };
        }
      },
      { action: "cancel", label: "Cancel" }
    ],
    rejectClose: false
  });

  return (chosen && (typeof chosen === "object")) ? chosen : null;
}

/**
 * A Maneuver's own Ki Point cost, before anything is declared.
 *
 * `kiCostPerBaseTier` is the "2(bT)" notation, and it was being read for the Defend
 * options and nowhere else - so a Maneuver written with it cost nothing at all. The two
 * are alternatives rather than additions: a Maneuver states its price one way or the
 * other.
 */
function baseKiCost(maneuver, actor) {
  return maneuver.kiCostPerBaseTier
    ? maneuver.kiCostPerBaseTier * (actor?.system?.baseTierOfPower ?? 1)
    : (maneuver.kiCost ?? 0);
}

/** What a Maneuver costs in Ki once its declared Profile is taken into account. */
export function maneuverKiCost(maneuver, declared, actor) {
  // One path whether or not a Profile has been declared. It used to fork, and the
  // branch that answers "what does this cost" for the sheet had quietly lost the
  // half that applies to Attacking Maneuvers - so Drained raising the price of every
  // attack was true when you paid and invisible when you looked.
  const base = baseKiCost(maneuver, actor)
    + (declared ? PROFILES[declared.profile].kiCost : 0);

  const slots = actor?.system?.effects?.slots;

  // A named Maneuver can be discounted on its own; an Attacking one also takes whatever
  // applies to attacks in general.
  let cost = applySlot(slots, `${maneuver.id}.kiCost`, base);
  if (actor && maneuver.attacking) cost = applySlot(slots, "attack.kiCost", cost);

  // The wager is Ki spent on the attack like any other, so it is paid here - which is
  // also what takes it out of Capacity. A Talent that cheapens Attacking Maneuvers
  // discounts the Maneuver, never the wager: the wager is what you chose to spend.
  return Math.max(0, cost) + (declared?.kiWager ?? 0);
}

/**
 * How many uses of a limited Maneuver a character has left. A Maneuver with no limit
 * is always available, so it reports Infinity rather than a number to compare.
 */
export function maneuverUsesLeft(actor, maneuver) {
  if (!maneuver.usageLimit) return Infinity;

  const spent = (actor.system.usedManeuvers ?? []).filter(entry => usedIs(entry, maneuver)).length;
  return Math.max(0, maneuver.usageLimit.amount - spent);
}

/**
 * Whether a recorded use is a use of this Maneuver.
 *
 * A use is written with the period it is counted against - `round:energy-cancel` - so
 * that a new Combat Round can clear the ones it owns and leave the per-Encounter ones
 * alone. A bare id is a use recorded before that was true, and still counts: a Maneuver
 * has one limit, so there is never more than one form of its own entry in the list.
 */
function usedIs(entry, maneuver) {
  return (entry === maneuver.id) || (entry === `${maneuver.usageLimit.per}:${maneuver.id}`);
}

/**
 * Record one use of a limited Maneuver.
 *
 * Written with its period, because that is what tells a new Round which uses it hands
 * back. Without it every use looked alike, the Round could not tell them apart, and a
 * Maneuver limited to once per Round was in practice once per Encounter.
 */
export async function recordManeuverUse(actor, maneuver) {
  if (!maneuver.usageLimit) return;
  const entry = `${maneuver.usageLimit.per}:${maneuver.id}`;
  await actor.update({ "system.usedManeuvers": [...actor.system.usedManeuvers, entry] });
}

/** "[1/Encounter]", as the rules write it in a Maneuver's name. */
export function usageLimitLabel(maneuver) {
  if (!maneuver.usageLimit) return "";
  const { amount, per } = maneuver.usageLimit;
  return `${amount}/${per.charAt(0).toUpperCase()}${per.slice(1)}`;
}


/** Loaded maneuver definitions, keyed by id. Populated by loadManeuvers(). */
const maneuvers = new Map();

/** Every loaded Maneuver, in the order the file lists them. */
export function allManeuvers() {
  return [...maneuvers.values()];
}

/** A Maneuver definition, or undefined if the id is unknown. */
export function getManeuver(id) {
  return maneuvers.get(id);
}

/**
 * Load the Maneuver list. Unlike races, these live in a single file: a Maneuver is
 * a rule rather than something a group is expected to extend piecemeal.
 */
/** "1/encounter" as the shape the rest of the system reads. */
function parseLimit(text) {
  const match = String(text ?? "").match(/^(\d+)\s*\/\s*(round|encounter)$/i);
  return match ? { amount: Number(match[1]), per: match[2].toLowerCase() } : null;
}

export async function loadManeuvers() {
  maneuvers.clear();

  // Read from the files under traits/maneuvers/, the same place a homebrew Maneuver
  // goes. The registry is still keyed by id, because several rules name a Maneuver
  // rather than owning one - Cross Counter grants "basic-attack", and the cost of a
  // Defend option is asked for without anyone holding the Maneuver.
  const definitions = traitsOfKind("maneuvers").map(trait => ({
    ...trait,
    actionCost: trait.actionCost ?? 1,
    kiCost: trait.kiCost ?? 0,
    attacking: Boolean(trait.attacking),
    requiresTarget: Boolean(trait.requiresTarget),
    defend: Boolean(trait.defend),
    surge: Boolean(trait.surge),
    charge: Boolean(trait.charge),
    cancelCharge: Boolean(trait.cancelCharge),
    usageLimit: parseLimit(trait.usageLimit),
    clash: trait.clashSkill ? { skill: trait.clashSkill } : null
  }));

  for (const maneuver of definitions) {
    if (!maneuver?.id || !maneuver?.name) {
      console.warn("DBU TTRPG | A maneuver is missing an id or a name; skipping.", maneuver);
      continue;
    }
    if (!MANEUVER_TYPES[maneuver.type]) {
      console.warn(`DBU TTRPG | Maneuver "${maneuver.id}" has an unknown type "${maneuver.type}"; skipping.`);
      continue;
    }
    if (maneuver.profile && (maneuver.profile !== "any") && !PROFILES[maneuver.profile]) {
      console.warn(`DBU TTRPG | Maneuver "${maneuver.id}" has an unknown profile "${maneuver.profile}"; skipping.`);
      continue;
    }
    if (maneuvers.has(maneuver.id)) {
      console.warn(`DBU TTRPG | Maneuver id "${maneuver.id}" is defined more than once; keeping the first.`);
      continue;
    }
    maneuvers.set(maneuver.id, maneuver);
  }

  console.log(`DBU TTRPG | Loaded ${maneuvers.size} maneuver(s)`);
}
