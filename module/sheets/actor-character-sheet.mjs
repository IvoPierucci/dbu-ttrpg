const { ActorSheetV2 } = foundry.applications.sheets;
const { HandlebarsApplicationMixin } = foundry.applications.api;

import DBUCharacterData from "../data/actor-character.mjs";
import { importCoreTalents, ownedTalents, reloadCoreTalents } from "../talents.mjs";
import { reactiveFor } from "../effects/registry.mjs";
import { resourceCeiling, resourceDefinitions, traitsOfKind } from "../effects/traits.mjs";
import { EDGES, KINDS } from "../durations.mjs";
import { COLLISION_DAMAGE, FEATURE_QUALITIES, HARDNESS_RANKS, hardnessValue } from "../features.mjs";
import { WEATHER_RULES, WEATHER_TIERS } from "../weather.mjs";
import { ENVIRONMENT_RULES, HIGH_ENVIRONMENTS, STANDARD_ENVIRONMENT, highEnvironment,
  qualitiesOf } from "../environments.mjs";
import { canSuffocate, difficultiesMet, heldBreath, isUnbreathable, settleBreath }
  from "../breath.mjs";
import {
  combatConditionsFor,
  marksFor,
  setCondition,
  traitActive,
  setState,
  statesFor,
  toggleCondition,
  toggleState
} from "../conditions.mjs";
import { actionsLeft, isTheirTurn, newRoundFor, spendActions } from "../combat.mjs";
import { whyNotAnotherInstant, whyNotSpecial } from "../maneuvers.mjs";
import { baseDieLine, breakdownTable, extraDiceLine, partLine, noteLine, floorLine,
         fromOutcome } from "../breakdown.mjs";
import { fireMoment } from "../effects/moments-runtime.mjs";
import {
  checkCard,
  difficultyLine,
  evaluateCheck,
  enterEncounter,
  prepareRoll,
  rollSteadfastCheck,
  whyNotWilling
} from "../chat.mjs";
import {
  MANEUVER_TYPES,
  PROFILES,
  maneuverEntry,
  maneuverKiCost,
  maneuverUsesLeft,
  usageLimitLabel
} from "../maneuvers.mjs";
import {
  coreManeuverItems,
  definitionOf,
  delayedManeuver,
  escapeGrapple,
  importCoreManeuvers,
  releaseGrapple,
  useOwnedManeuver
} from "../use-maneuver.mjs";
import {
  exclusiveAttributeGroups,
  raceOptions,
  raceSubraces,
  racialAttributeChoices,
  racialSkillRankCount,
  subraceName
} from "../races.mjs";

/**
 * DBU TTRPG character sheet, built on the modern ApplicationV2 / ActorSheetV2
 * API (recommended approach as of Foundry v13+, required going forward in v14+).
 */

/**
 * What one Slot contribution is called, and which way it points.
 *
 * The rules name these operations rather than writing them as arithmetic - "reduce your
 * Soak Value by 2(bT)", "the Dice Score of the Wound Roll is halved" - so each row says
 * the operation and lets the number speak for itself.
 */
function contributionLine(part) {
  const value = Number(part.value) || 0;
  const label = part.source || "an effect";

  switch (part.op) {
    case "multiply":
      return { ...partLine({ label, value: 0, rank: "negative" }),
        written: `x${value}`, shown: `x${value}` };
    case "set":
      return { ...partLine({ label, value, rank: "positive" }),
        written: `set ${value}`, shown: `= ${value}` };
    case "min":
      return { ...partLine({ label, value, rank: "positive" }),
        written: `at least ${value}`, shown: `>= ${value}` };
    case "max":
      return { ...partLine({ label, value, rank: "negative" }),
        written: `at most ${value}`, shown: `<= ${value}` };
    default:
      return partLine({ label, value });
  }
}

/**
 * One derived value's workings, as the table a roll's hover uses.
 *
 * `key` may be a chain, for a value that went through more than one Slot on its way -
 * the Soak Value is `soakValue` and then `soakValue.external`, one for what the character
 * has and one for what anybody else did to it. The base and its ingredients come from the
 * first; every Slot's contributions follow in the order they were applied; the total is
 * the last one's.
 *
 * `extra` is for what the sheet cannot fold into the number: anything applied when the
 * dice come out rather than when the character is derived. Those arrive as notes, which
 * sit below the total rather than inside the sum.
 *
 * `total` overrides the answer, for the values clamped once more outside every Slot. A
 * table whose answer differs from the number it is attached to is worse than no table.
 */
function workingsTable(system, key, { extra = [], total = null } = {}) {
  const keys = Array.isArray(key) ? key : [key];
  const steps = keys.map(one => system.effects?.workings?.[one]).filter(Boolean);
  if (!steps.length) return "";

  const lines = [];
  const first = steps[0];

  // The base by its ingredients where the data model named them, and as one number where
  // it did not. A part worth nothing is left out: "Size 0" is a row saying only that Size
  // did not apply.
  const named = (first.parts ?? []).filter(part => Number(part.value) !== 0);
  if (named.length) for (const part of named) lines.push(partLine({ label: part.label, value: part.value }));
  else lines.push(partLine({ label: "Base", value: first.base }));

  for (const step of steps) {
    for (const part of step.contributions ?? []) lines.push(contributionLine(part));

    if ((step.floored !== null) && (step.floored !== undefined)) {
      lines.push(floorLine(step.base, step.floored, "nothing goes below zero"));
    }
  }

  for (const note of extra) if (note) lines.push(noteLine(note));

  return breakdownTable(lines, total ?? steps[steps.length - 1].value);
}

/**
 * Everything a Combat Roll picks up between the sheet and the dice.
 *
 * None of it is in the number above, and none of it can be: Diminishing Offense counts
 * the attacks made this Combat Round, the Health Threshold penalty follows the Life
 * Points, and the Muscle Penalty follows the Super Stacks held right now. All three are
 * true of a roll rather than of a character, so they are said rather than folded in - the
 * number on the sheet stays the one the rules call the Strike Roll.
 */
function atRollTime(system, which) {
  const notes = [];

  if (which === "strike") {
    const { stacks = 0, penalty = 0 } = system.diminishing?.offense ?? {};
    if (penalty) notes.push(`-${penalty} Diminishing Offense, from ${stacks} stack(s) this round`);
  }
  if (which === "dodge") {
    const { penalty = 0 } = system.diminishing?.defense ?? {};
    if (penalty) notes.push(`-${penalty} Diminishing Defense, from ${penalty} stack(s) this round`);
  }

  // On the Strike and the Dodge, not on the Wound: the Muscle Penalty is written against
  // the rolls you make with your body rather than the damage they do.
  if ((which === "strike") || (which === "dodge")) {
    const muscle = system.superStack?.musclePenalty ?? 0;
    if (muscle) notes.push(`-${muscle} Muscle Penalty, from ${system.superStack.stacks} Super Stack(s)`);
  }

  // Every Combat Roll, the Wound Roll included. Failed Steadfast Checks, not the
  // Threshold itself: reaching one costs nothing, and losing the Check it asks for costs
  // 1(bT) on every Combat Roll from then on.
  const threshold = system.threshold?.penalty ?? 0;
  const failures = system.threshold?.failures ?? 0;
  if (threshold) {
    notes.push(`-${threshold} from ${failures} failed Steadfast Check${
      failures === 1 ? "" : "s"} at a Health Threshold`);
  }

  const extra = system.dice?.extra?.formula ?? "";
  if (extra) notes.push(`+${extra} Tier of Power Extra Dice, on every Combat Roll`);

  return notes;
}

/**
 * The Resources a character is holding, as rows for the sheet.
 *
 * Not a checklist like the Conditions and the States: nobody has a Resource until
 * something gives them one, so this lists what is held rather than everything that
 * exists. A Resource at nothing is not held either - the runtime deletes the key rather
 * than leaving a zero behind - so there is no empty row to filter out.
 *
 * Every Resource rather than the interesting one, because they are all invisible the
 * same way and each is doing something worth seeing: Power raises every Combat Roll,
 * Recovery is the Defense Value that Combat Recovery cost, Rapid Movement is the Strike
 * bonus, Arrogance is the penalty waiting for you when Superior ends.
 */
function resourceRows(system, owned = null) {
  const held = system.resources ?? {};
  const known = resourceDefinitions();
  const timed = system.timed ?? [];

  // Everything this character could have, and everything they do. A Resource you can get
  // belongs on the list at nothing - everybody has the Power Up Maneuver, so everybody
  // can hold Power, and a row that appears only once you have some cannot tell you the
  // Resource is there. That is why the two checklists above it list what you could have.
  //
  // "Could have" is holding the Trait that hands it out, which today means owning that
  // Maneuver: every Resource in the library is declared by one. When a Condition or a
  // Talent declares one, this is the line that grows.
  const reachable = Object.entries(known)
    .filter(([, definition]) => !definition.internal
      && definition.id && owned?.has(definition.id))
    .map(([key]) => key);

  const keys = [...new Set([
    ...Object.keys(held).filter(key => (Number(held[key]?.stacks) || 0) > 0),
    ...reachable
  ])];

  return keys
    // Only the ones the rules name. The rest are this system's own bookkeeping - they
    // are held as Resources because that is what takes a clock here, and a player has
    // never been told that word for them. What each is doing is said where it happens:
    // on the roll it changes, and on the card that applied it.
    .filter(key => !known[key]?.internal)
    .map(key => {
      const resource = held[key] ?? {};
      const definition = known[key] ?? {};
      const name = definition.label || (key.charAt(0).toUpperCase() + key.slice(1));
      return {
        key,
        name,
        stacks: Number(resource.stacks) || 0,
        // The file's ceiling wins over the one written onto the character: the file is
        // where the rule lives, and a character still carrying an older copy of it
        // should not go on being measured against that one.
        //
        // And a ceiling the file states as a value about the character - "the maximum you
        // can possess is equal to your base Tier of Power" - is worked out here, from the
        // same data the row is drawn from.
        max: resourceCeiling(definition, { system }) || (Number(resource.max) || 0),
        note: clockNotes(timed, key).join(" \u00b7 "),
        tooltip: definition.source
          ? `From ${definition.source}. ${definition.description ?? ""}`.trim()
          : `${name}, held as a Resource.`
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Everything this character is carrying stacks of.
 *
 * The Resources, and the two Diminishing counters with them. Those two are not Resources
 * - they are wear a round puts on you and takes off again, and the Turn State panel goes
 * on holding the editable copy of each with what it is costing - but they stack, and
 * "what am I carrying stacks of" is one question that ought to have one answer.
 *
 * They lead the list because they are always there. A Resource appears only while it is
 * held, so a list that sorted everything together would have rows arriving and leaving
 * above ones that never move.
 */
function stackRows(system, owned = null) {
  const { offense, defense } = system.diminishing ?? {};
  const { superStack } = system;

  return [
    {
      key: "diminishing.offense",
      name: "Diminishing Offense",
      stacks: offense?.stacks ?? 0,
      // Neither has a ceiling: you go on gathering them until the round turns over.
      max: 0,
      note: offense?.penalty ? `Strike -${offense.penalty}` : "",
      tooltip: "One stack for each Attacking Maneuver after the third this round. Each "
        + "takes 1(bT) off your Strike Rolls."
    },
    {
      key: "diminishing.defense",
      name: "Diminishing Defense",
      stacks: defense?.stacks ?? 0,
      max: 0,
      note: defense?.penalty ? `Dodge -${defense.penalty}` : "",
      tooltip: "One stack for each Attacking Maneuver aimed at you, unless you use the "
        + "Defend Maneuver. Each takes 1 off your Dodge Rolls."
    },
    {
      key: "superStack",
      name: "Super Stacks",
      stacks: superStack?.stacks ?? 0,
      // The one of the three with a ceiling of its own, and it is a real one - held
      // until something takes it away rather than cleared by the round like the two
      // above.
      max: superStack?.max ?? 0,
      note: [
        superStack?.musclePenalty ? `Strike & Dodge -${superStack.musclePenalty}` : "",
        superStack?.solidBulk ? `Soak +${superStack.solidBulk}` : "",
        superStack?.massivePower ? `Wound +${superStack.massivePower}` : ""
      ].filter(Boolean).join(" \u00b7 "),
      tooltip: "Muscle Penalty: 1(bT) off Strike and Dodge per stack, 1(bT) more at "
        + "three. Solid Bulk: 1(bT) of Soak per stack. Massive Power: 1/4 of your Force "
        + "Modifier on the Wound Rolls of Physical and Energy Attacks, per stack."
    },
    ...resourceRows(system, owned)
  ];
}

/**
 * The Traits this character carries, by the id a Trait file is keyed under.
 *
 * Which is what answers "could they get this Resource". Maneuvers only, because a
 * Maneuver is the only kind of Trait that declares one today - a Maneuver Item carries
 * the id of the file it came from, and one built by hand carries none, which is right:
 * a Maneuver somebody wrote themselves declares no Resource.
 */
function traitsOwned(actor) {
  return new Set(actor.items
    .filter(item => item.type === "maneuver")
    .map(item => item.system.maneuverId)
    .filter(Boolean));
}

/**
 * When a mark on this character lifts, in the words the clock is kept in.
 *
 * The clock can be on somebody else - Analyzed is timed by whoever Analyzed you, because
 * "until the end of YOUR next turn" is their turn - so this looks on the character first
 * and then on everybody a token on the scene belongs to. A mark whose timer is nowhere to
 * be found says nothing rather than claiming a turn it has not got: a GM who ticked it by
 * hand is the usual reason, and it is theirs to lift.
 */
function markClock(actor, key) {
  const mine = (actor.system.timed ?? []).filter(entry =>
    (entry?.kind === KINDS.CONDITION) && (entry.key === key) && !entry.on);
  if (mine.length) return clockNotes(mine, key, KINDS.CONDITION).join(" · ");

  for (const token of canvas?.tokens?.placeables ?? []) {
    const other = token.actor;
    if (!other || (other.uuid === actor.uuid)) continue;

    const theirs = (other.system.timed ?? []).filter(entry =>
      (entry?.kind === KINDS.CONDITION) && (entry.key === key) && (entry.on === actor.uuid));
    if (!theirs.length) continue;

    const when = clockNotes(theirs, key, KINDS.CONDITION).join(" · ")
      .replace(/your turn/g, `${other.name}'s turn`)
      .replace(/your next turn/g, `${other.name}'s next turn`);
    return when;
  }

  return "";
}

/**
 * When the clocks on one thing run out, counted rather than summarised.
 *
 * Each stack is put on a clock of its own where the rule gives it one - "gain a stack of
 * Power until the end of your next turn" - so stacks taken in different turns leave in
 * different turns, and the row says so: "1 at the end of your turn - 1 at the end of your
 * next turn" rather than a flat 2.
 *
 * "Your turn" means the next turn of yours that still has that edge ahead of it, which is
 * what the edges left on the entry are counting. Something with no clock at all is
 * something nothing will take away, and says nothing here rather than claiming a turn it
 * has not got - the GM put it there and the GM takes it off.
 *
 * The kind is asked for rather than assumed. This was written for Resources and what it
 * actually reads is a clock, which Conditions and States are on too - and it quietly
 * dropped every entry that was not a Resource, so the mark rows beside Charging and
 * Holding were asking when Hyped lifts and being answered about nothing at all.
 */
function clockNotes(timed, key, kind = KINDS.RESOURCE) {
  const counts = new Map();

  for (const entry of timed) {
    if ((entry?.kind !== kind) || (entry.key !== key)) continue;
    const when = entry.edge === EDGES.ENCOUNTER
      ? "when the Encounter ends"
      : `at the ${entry.edge === EDGES.START ? "start" : "end"} of your `
        + `${((entry.edges ?? 1) > 1) ? "next turn" : "turn"}`;
    counts.set(when, (counts.get(when) ?? 0) + 1);
  }

  return [...counts].map(([when, count]) => `${count} ${when}`);
}

export default class DBUCharacterSheet extends HandlebarsApplicationMixin(ActorSheetV2) {

  static DEFAULT_OPTIONS = {
    classes: ["dbu-ttrpg", "character"],
    // Talents and Maneuvers are both Items, so the sheet accepts either being dropped
    // on it - and lets either be dragged off, a Maneuver most usefully onto the hotbar.
    dragDrop: [{ dragSelector: "[data-item-id][draggable]", dropSelector: null }],
    position: {
      width: 700,
      height: 780
    },
    window: {
      resizable: true
    },
    actions: {
      rollAttribute: DBUCharacterSheet._onAttributeRoll,
      dbuChangeTab: DBUCharacterSheet._onChangeTab,
      rollSkill: DBUCharacterSheet._onSkillRoll,
      rollSave: DBUCharacterSheet._onSaveRoll,
      toggleRacialTrait: DBUCharacterSheet._onToggleRacialTrait,
      rollInitiative: DBUCharacterSheet._onInitiativeRoll,
      useManeuver: DBUCharacterSheet._onUseManeuver,
      resetCapacity: DBUCharacterSheet._onResetCapacity,
      resetEncounter: DBUCharacterSheet._onResetEncounter,
      enterEncounter: DBUCharacterSheet._onEnterEncounter,
      steadfastCheck: DBUCharacterSheet._onSteadfastCheck,
      importTalents: DBUCharacterSheet._onImportTalents,
      reloadTalents: DBUCharacterSheet._onReloadTalents,
      importManeuvers: DBUCharacterSheet._onImportManeuvers,
      attackFeature: DBUCharacterSheet._onAttackFeature,
      takeCollision: DBUCharacterSheet._onTakeCollision,
      toggleQuality: DBUCharacterSheet._onToggleQuality,
      holdBreath: DBUCharacterSheet._onHoldBreath,
      grantManeuvers: DBUCharacterSheet._onGrantManeuvers,
      armTalent: DBUCharacterSheet._onArmTalent,
      editItem: DBUCharacterSheet._onEditItem,
      toggleManeuver: DBUCharacterSheet._onToggleManeuver,
      releaseGrapple: DBUCharacterSheet._onReleaseGrapple,
      escapeGrapple: DBUCharacterSheet._onEscapeGrapple,
      deleteItem: DBUCharacterSheet._onDeleteItem,
      toggleCombatEdit: DBUCharacterSheet._onToggleCombatEdit,
      toggleCondition: DBUCharacterSheet._onToggleCondition,
      toggleState: DBUCharacterSheet._onToggleState,
      stepState: DBUCharacterSheet._onStepState,
      stepCondition: DBUCharacterSheet._onStepCondition,
      useConditionAbility: DBUCharacterSheet._onUseConditionAbility,
      stepKarma: DBUCharacterSheet._onStepKarma,
      editImage: DBUCharacterSheet._onEditImage
    },
    form: {
      submitOnChange: true
    }
  };

  static PARTS = {
    header: { template: "systems/dbu-ttrpg/templates/parts/actor-header.hbs" },
    tabs: { template: "systems/dbu-ttrpg/templates/parts/sheet-tabs.hbs" },
    main: { template: "systems/dbu-ttrpg/templates/parts/actor-main.hbs", scrollable: [""] },
    combat: { template: "systems/dbu-ttrpg/templates/parts/actor-combat.hbs", scrollable: [""] },
    maneuvers: {
      template: "systems/dbu-ttrpg/templates/parts/actor-maneuvers.hbs",
      scrollable: [""]
    },
    traits: { template: "systems/dbu-ttrpg/templates/parts/actor-traits.hbs", scrollable: [""] },
    battlefields: {
      template: "systems/dbu-ttrpg/templates/parts/actor-battlefields.hbs",
      scrollable: [""]
    },
    progression: {
      template: "systems/dbu-ttrpg/templates/parts/actor-progression.hbs",
      scrollable: [""]
    },
    biography: {
      template: "systems/dbu-ttrpg/templates/parts/actor-biography.hbs",
      scrollable: [""]
    }
  };

  tabGroups = { primary: "main" };

  /**
   * Whether the Combat tab's tracking values are unlocked. Deliberately not stored on
   * the Actor: it is a guard against stray clicks during play, not a character trait,
   * and it should lapse when the sheet is closed.
   */
  #combatEditMode = false;

  /**
   * Which collapsible sections are open, by their `data-section` name.
   *
   * The template renders from this rather than deciding for itself, and that ordering
   * is the whole point. Foundry restores a `details[data-sync]` *after* it has restored
   * the scroll position, so a section that opens or closes at that moment changes the
   * height under a scroll that was already set - which is the jump. Rendering the real
   * state means nothing moves after the fact.
   *
   * It also settles the rule the sections follow: they open when the player opens them
   * and close when the player closes them. Whether anything is active does not enter
   * into it - a section flinging itself open because a Condition was ticked is the
   * same jump wearing a different hat.
   */
  // Anything not named here starts closed - States and Combat Conditions among them,
  // which is what keeps a long checklist from taking over the Combat tab. The Maneuver
  // groups default the other way, in _prepareManeuverGroups.
  #openSections = { talents: true };

  /** ApplicationV2 does not wire drag and drop itself; each sheet binds its own. */
  #dragDrop = this.options.dragDrop.map(config => new foundry.applications.ux.DragDrop.implementation({
    ...config,
    permissions: {
      dragstart: () => this.isEditable,
      drop: () => this.isEditable
    },
    callbacks: {
      dragstart: this._onDragStart.bind(this),
      drop: this._onDrop.bind(this)
    }
  }));

  /** Let an owned Item be dragged off the sheet, to another actor or the directory. */
  async _onDragStart(event) {
    const item = this.actor.items.get(event.currentTarget.dataset.itemId);
    if (!item) return;
    event.dataTransfer.setData("text/plain", JSON.stringify(item.toDragData()));
  }

  /** Every kind of Item a character can be given. */
  static ACCEPTS = ["talent", "maneuver"];

  /** Accept an Item dropped onto the sheet, copying it onto this character. */
  async _onDrop(event) {
    if (!this.isEditable) return;

    const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
    if (data?.type !== "Item") return;

    const item = await Item.implementation.fromDropData(data);
    if (!item) return;

    if (!DBUCharacterSheet.ACCEPTS.includes(item.type)) {
      ui.notifications.warn(
        `${item.name} cannot be given to a character. This sheet takes `
        + `${DBUCharacterSheet.ACCEPTS.join(" and ")} Items.`
      );
      return;
    }
    // Dropping an Item the character already owns is a re-order, not a second copy.
    if (this.actor.items.has(item.id)) return;

    return this.actor.createEmbeddedDocuments("Item", [item.toObject()]);
  }

  static TABS = {
    main: { id: "main", group: "primary", label: "Main" },
    combat: { id: "combat", group: "primary", label: "Combat" },
    // Beside the Combat tab rather than inside it. Four lists of rows that each open to
    // a published entry is most of a page on its own, and it was the part of that tab a
    // player scrolled past everything else to reach.
    maneuvers: { id: "maneuvers", group: "primary", label: "Maneuvers" },
    traits: { id: "traits", group: "primary", label: "Traits" },
    // A section of the rules that has not been given yet. The tab is here so there is
    // somewhere for it to go; what fills it is written when the rules arrive rather than
    // guessed at from the name.
    //
    // Beside Traits rather than inside Combat: a Battlefield is something the whole table
    // is standing in, and the Combat tab is this character's own tracking values.
    battlefields: { id: "battlefields", group: "primary", label: "Battlefields" },
    progression: { id: "progression", group: "primary", label: "Progression" },
    biography: { id: "biography", group: "primary", label: "Biography" }
  };

  /** The character's Maneuver Items, as the plain definitions the rules speak in. */
  #ownedManeuvers() {
    return this.actor.items
      .filter(item => item.type === "maneuver")
      .map(definitionOf)
      .sort((a, b) => a.name.localeCompare(b.name));
  }


  /**
   * What every value on the sheet is made of, as a table per value.
   *
   * Built here rather than in the data model because it is a description for a reader,
   * not a number anything computes with - and because two of the three things it has to
   * say are the sheet's own business: which values are worth explaining, and what a
   * Combat Roll picks up on its way to the dice.
   *
   * Keyed by the Slot the value came from, which is the same key the data model filed
   * its workings under. A value whose key is wrong shows no table rather than somebody
   * else's - workingsTable returns nothing for a key it has never heard of.
   */
  #workings() {
    const system = this.actor.system;
    const of = (key, extra = []) => workingsTable(system, key, { extra });

    const tables = {
      // Aptitudes.
      might: of("might"),
      surgency: of("surgency"),
      // Two Slots: what this character has, then what anybody else did to it. And the
      // total given outright, because the Soak Value is floored at zero once more after
      // both of them - `soakShortfall` is what that floor swallowed.
      soakValue: workingsTable(system, ["soakValue", "soakValue.external"],
        { total: system.soakValue }),
      damageReduction: of("damageReduction"),
      initiative: of("initiative"),
      haste: of("haste"),
      awareness: of("awareness"),
      defenseValue: of("defenseValue"),
      meleeRange: of("meleeRange"),
      stressBonus: of("stressBonus"),
      "life.max": of("life.max"),
      "ki.max": of("ki.max"),

      // Combat Rolls, each with what it gathers when the dice come out.
      strike: of("strike", atRollTime(system, "strike")),
      dodge: of("dodge", atRollTime(system, "dodge")),
      parry: of("parry", atRollTime(system, "strike"))
    };

    // A Wound Roll per Foundation: one Slot, three values, three tables.
    for (const key of Object.keys(DBUCharacterData.FOUNDATIONS)) {
      tables[`wound.${key}`] = of(`wound.${key}`, atRollTime(system, "wound"));
    }

    for (const key of Object.keys(system.attributes)) tables[`${key}.mod`] = of(`${key}.mod`);
    for (const key of Object.keys(system.skills)) {
      tables[`skill.${key}`] = of(`skill.${key}`);
      tables[`skill.${key}.bonus`] = of(`skill.${key}.bonus`);
    }
    for (const key of Object.keys(system.savingThrows)) tables[`save.${key}`] = of(`save.${key}`);

    return tables;
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    // DocumentSheetV2 exposes the document as `document`, not `actor`. The header
    // template reads `actor.name` / `actor.img`, so expose it under that name too -
    // without this the name input renders empty and appears to wipe itself on save.
    context.actor = this.actor;
    context.system = this.actor.system;
    context.tabs = this._getTabs();
    context.progressionRows = this._prepareProgressionRows();
    // Handlebars has no literal-array helper, so the Attribute columns are supplied
    // here. The progression table's headings and cells both read from this, so they
    // cannot drift apart.
    context.attributeColumns = Object.entries(this.actor.system.attributes).map(([key, attribute]) => ({
      key,
      abbr: DBUCharacterData.ATTRIBUTE_ABBREVIATIONS[key],
      score: attribute.score
    }));
    // Bar widths, since Handlebars cannot divide.
    context.lifePercent = DBUCharacterSheet.#percentFull(this.actor.system.life);
    context.kiPercent = DBUCharacterSheet.#percentFull(this.actor.system.ki);
    // Wound is per Foundation, so the labels come from the same config the values do.
    context.woundRolls = Object.entries(DBUCharacterData.FOUNDATIONS).map(([key, foundation]) => ({
      label: foundation.label,
      value: this.actor.system.combat.wound[key],
      workings: workingsTable(this.actor.system, `wound.${key}`,
        { extra: atRollTime(this.actor.system, "wound") })
    }));

    // What each value is made of, for the hover on it.
    context.workings = this.#workings();

    // Attributes and Saving Throws as rows rather than as the raw objects: each needs
    // the table for its own key, and a template cannot build "agility" + ".mod".
    context.attributeCards = Object.entries(this.actor.system.attributes).map(([key, attribute]) => ({
      key,
      mod: attribute.mod,
      bonus: attribute.bonus,
      workings: context.workings[`${key}.mod`]
    }));

    context.saves = Object.entries(this.actor.system.savingThrows).map(([key, save]) => ({
      key,
      ...save,
      workings: context.workings[`save.${key}`]
    }));

    context.combatEditMode = this.#combatEditMode;
    // Offered until it is taken. Not gated on there being a Combat in the tracker: a
    // table running an Encounter without one still has an Encounter, and this is the
    // only door to its start for them.
    context.canEnterEncounter = !this.actor.system.enteredEncounter;
    // What is left of each pool right now. Derived rather than stored: what is stored
    // is what has been spent, so the sheet cannot drift from what the rules allow.
    context.actionsLeft = {
      standard: actionsLeft(this.actor, "standard"),
      counter: actionsLeft(this.actor, "counter")
    };
    context.openSections = this.#openSections;
    context.threshold = this.actor.system.threshold;

    // Combat Conditions: every one the system knows, marked with what this character
    // has, so the section is a checklist rather than a list of what is already wrong.
    context.conditions = combatConditionsFor(this.actor);
    const held = context.conditions.filter(c => c.active);
    context.anyCondition = held.length > 0;
    context.conditionSummary = held
      .map(c => (c.stacking ? `${c.name} ${c.stacks}` : c.name))
      .join(", ");
    context.conditionAbilities = this.#conditionAbilities();

    // Everything with stacks, the two Diminishing counters included. Not the Resources
    // alone, which is why it is not called that: the section is about what you are
    // carrying, and those two are carried the same way even though they are not Resources.
    context.stacks = stackRows(this.actor.system, traitsOwned(this.actor));
    // What the summary line says when the section is shut - the same shape the States and
    // the Combat Conditions use, and only what is actually there.
    const carried = context.stacks.filter(row => row.stacks > 0);
    context.anyStacks = carried.length > 0;
    context.stackSummary = carried
      .map(row => `${row.name} ${row.stacks}${row.max ? `/${row.max}` : ""}`)
      .join(", ");
    // The marks that are not Combat Conditions - Hyped, Analyzed - said beside Charging
    // and Holding, because they are the same kind of thing: something you are in the
    // middle of, with a name and an end. Each carries when it lifts, which is on whoever
    // is counting it rather than on whoever is carrying it.
    context.marks = marksFor(this.actor).map(mark => ({
      ...mark,
      note: markClock(this.actor, mark.key)
    }));

    // "Treat all Battle Weathers as if they were 1 Weather Tier lower." There are no
    // Battle Weathers in this system, so what this does is say the number: the table takes
    // it off whatever Weather is in play, and a Tier reduced to 0 is a Weather that does
    // nothing to you.
    //
    // Read off the Slot rather than off the Brace Maneuver, so anything else that lowers a
    // Weather Tier lands in the same row without this having to hear about it.
    const weatherTiers = this.actor.system.effects?.slots?.["weather.tiers"] ?? 0;
    // Inside somebody, which is a thing you are in the middle of like Charging or Holding -
    // and the one of them that takes you out of the Initiative Order, so it is worth saying
    // where the turn state is said rather than only on a card that scrolls away.
    const inside = this.actor.system.inside;
    context.inside = inside?.targetUuid
      ? {
          name: inside.targetName,
          initiative: inside.initiative,
          note: inside.initiative
            ? `Back in the Order at Initiative ${inside.initiative}`
            : "No Initiative was recorded"
        }
      : null;

    // What Item they were turned into, and whether the second Clash landed. The Condition
    // says they are Transfigured; this says what they are, which is the thing the table
    // needs for the rest of the Encounter and which the card that named it does not keep.
    const { system } = this.actor;
    const asItem = (Number(system.resources?.anitem?.stacks) || 0) > 0;
    context.transfigured = system.transfigured?.item
      ? {
          item: system.transfigured.item,
          note: asItem
            ? "An Item outright: no Maneuvers of any kind until the Encounter ends"
            : "Transfigured, but still able to act"
        }
      : null;

    // The Light Levels, named and numbered by their own Trait files rather than by a list
    // here: the number sits beside the rule it carries, and a Level nobody wrote a file
    // for should go missing from the picker rather than be offered and do nothing.
    //
    // Filtered on the header that carries the number, which is the same test the registry
    // makes. Without it every Battlefield file was in the picker: Cover has no Light Level
    // and `Number(undefined) || 0` is 0, so it was being offered as "Cover (0)" beside
    // Normal, and picking it set the Level to 0.
    const levels = traitsOfKind("battlefields")
      .filter(trait => trait.lightLevel !== undefined)
      .map(trait => ({ value: Number(trait.lightLevel) || 0, trait }))
      .sort((a, b) => a.value - b.value);

    const standing = Number(system.battlefield?.lightLevel) || 0;

    context.lightLevels = levels.map(({ value, trait }) => ({
      value,
      label: `${trait.name} (${value > 0 ? "+" : ""}${value})`,
      chosen: value === standing
    }));

    // What the chosen one is doing, in the rulebook's own words. Blank where it does
    // nothing, which is what the template draws nothing for.
    const here = levels.find(level => level.value === standing)?.trait;
    context.lightLevel = {
      effect: here?.script ? (here.description ?? "") : ""
    };

    // What Cover is worth while it is on, in numbers rather than in notation: the
    // player is deciding whether to leave a toggle on and 2(T) is not an answer to that.
    const cover = system.battlefield?.cover ?? {};
    context.cover = {
      note: cover.active
        ? `Dodge +${2 * Math.max(1, system.tierOfPower ?? 1)}, and `
          + `${2 * Math.max(0, cover.hardness ?? 0)} off the Damage you would suffer `
          + `- twice a Hardness Value of ${Math.max(0, cover.hardness ?? 0)}.`
        : ""
    };

    // Every Attacking Maneuver they own, which is what can be thrown at a Feature -
    // "Features can be targets for any Attacking Maneuver, just like Characters can."
    // Hardness, with the Value worked out for this character. The Rank is the Feature's
    // and the Value is theirs - "twice the Hardness Rank multiplied by the base Tier of
    // Power of the Character who is suffering the Collision Damage" - so a table printed
    // with the Ranks alone would be a table nobody can use without doing the sum.
    // Battle Weather, for reading. Two lists rather than one: the Tiers are what a Weather
    // is set at, and the rules are what holds whichever Weather that is.
    //
    // `context.weather` is already taken, by the Brace Maneuver's Tier reduction on the
    // Combat tab. Named apart on purpose - one is a number about this character and the
    // other is the rulebook.
    // How far off the ground, and what that means for what is below. The first three
    // ranks are layered above the Battle Environment; the fourth is stated to work
    // differently and the rules do not yet say how, so it carries its own note.
    const aloft = Number(system.battlefield?.highEnvironment) || 0;
    context.highEnvironments = HIGH_ENVIRONMENTS.map(sky => ({
      ...sky,
      chosen: sky.rank === aloft
    }));

    const sky = highEnvironment(aloft);
    context.high = {
      rank: aloft,
      name: sky?.name ?? "",
      note: sky
        ? `${sky.text}${sky.note ? ` ${sky.note}` : ""} While you are up here the Battle `
          + "Environment below does not reach you - it is still what you would land in, "
          + "and the Qualities of your Square still apply."
        : ""
    };

    // Every Battle Environment file there is, for the picker. No blank option: a
    // character is standing on something, and what they are standing on is the Standard
    // Environment unless somebody says otherwise.
    const standingOn = system.battlefield?.environment || STANDARD_ENVIRONMENT;
    context.environments = traitsOfKind("battlefields")
      .filter(trait => trait.environment === true)
      .map(trait => ({
        id: trait.id,
        name: trait.name,
        chosen: trait.id === standingOn
      }));

    const environmentTrait = traitsOfKind("battlefields")
      .find(trait => trait.id === standingOn);
    context.environmentNow = {
      id: standingOn,
      effect: environmentTrait?.description ?? ""
    };
    // The Hardness Rank of the ground, offered within the range the Environment's own
    // file allows - "Hardness Rank: 1~5 (decided by the ARC)". An Environment with no
    // range stated has no ground to hit, and the row goes away rather than offering a
    // choice the rules do not make.
    const lowest = Number(environmentTrait?.hardnessMin);
    const highest = Number(environmentTrait?.hardnessMax);
    context.ground = Number.isFinite(lowest) && Number.isFinite(highest)
      ? {
          note: `What the ground here is made of, ${environmentTrait.name} being Hardness `
            + `Rank ${lowest} to ${highest}. This is what a Ground Collision costs you, `
            + "and it is the ARC's to pick.",
          // What the Square's own Qualities leave the Rank at, where that differs from
          // the one picked. Glass is one harder and Metallic is never below three, and a
          // player looking at a Ground Collision wants the number they will take.
          shifted: (system.battlefield?.groundRank !== system.battlefield?.groundHardness)
            ? {
                rank: system.battlefield.groundRank,
                note: "What the Qualities of this Square leave the Hardness Rank at. "
                  + "This is the one a Ground Collision is worked out from."
              }
            : null,
          ranks: HARDNESS_RANKS
            .filter(hardness => (hardness.rank >= lowest) && (hardness.rank <= highest))
            .map(hardness => ({
              rank: hardness.rank,
              material: hardness.material,
              chosen: hardness.rank === (system.battlefield?.groundHardness ?? lowest)
            }))
        }
      : null;

    // The Environmental Qualities there are, each marked with whether this Square has it
    // and whether that is the player's doing. The Environment's own come with the ground:
    // shown so the player can see what they are standing in, and not tickable, because
    // untickable is what "it comes with the ground" means.
    const environmentQualities = String(environmentTrait?.qualities ?? "")
      .split(",").map(id => id.trim()).filter(Boolean);
    // Not `held`: `_prepareContext` already has one, for the Combat Conditions this
    // character is carrying. Two `const`s of one name in one function is a SyntaxError,
    // and V8 reported it against a private method four hundred lines away.
    const squareHas = qualitiesOf(system, environmentTrait);

    context.qualities = traitsOfKind("qualities").map(quality => ({
      id: quality.id,
      name: quality.name,
      text: quality.description || quality.name,
      active: squareHas.includes(quality.id),
      fixed: environmentQualities.includes(quality.id)
    }));
    context.qualitySummary = squareHas.length
      ? context.qualities.filter(quality => quality.active)
          .map(quality => quality.name).join(", ")
      : "None";

    context.environmentRules = ENVIRONMENT_RULES;

    // Held Breath, and whether there is still a Check to make. Only where there is nothing
    // to breathe: everywhere else the number is zero and means nothing.
    context.breath = isUnbreathable(this.actor)
      ? {
          held: heldBreath(this.actor),
          // "Unless you are Unnatural or otherwise unable to gain the Suffocating Combat
          // Condition" - which is one question, and the answer decides whether the Check
          // is offered at all.
          canRoll: !system.battlefield.breathRolled && canSuffocate(this.actor),
          note: !canSuffocate(this.actor)
            ? "Nothing to breathe, and nothing that needs to: this character cannot "
              + "Suffocate."
            : heldBreath(this.actor) > 0
              ? "One goes at the end of each Combat Round, and one each time you are "
                + "knocked through a Health Threshold. At none of them you Suffocate, and "
                + "nothing takes that off but air."
              : "No breath left. Suffocating until you leave - nothing else removes it."
        }
      : null;

    // Every Battle Weather file there is, for the picker. Filtered on the header rather
    // than on the folder: Cover and the five Light Levels are Battlefield files too.
    const standingIn = system.battlefield?.weather?.id ?? "";
    context.weathers = traitsOfKind("battlefields")
      .filter(trait => trait.weather === true)
      .map(trait => ({
        id: trait.id,
        name: trait.name,
        chosen: trait.id === standingIn
      }));

    // The Tiers, each marked if it is the one set. The same list the reference section
    // below walks, which is why `chosen` is added rather than the list rebuilt.
    const tierNow = Number(system.battlefield?.weather?.tier) || 1;
    context.weatherTiers = WEATHER_TIERS.map(tier => ({
      ...tier,
      chosen: tier.tier === tierNow
    }));
    context.weatherRules = WEATHER_RULES;

    // What the Weather they are standing in does, in its own words. Drawn only when they
    // are standing in one: "Clear" has nothing to say.
    const weatherTrait = standingIn
      ? traitsOfKind("battlefields").find(trait => trait.id === standingIn)
      : null;
    context.weatherNow = {
      id: standingIn,
      effect: weatherTrait?.description ?? ""
    };

    context.collisionDamage = COLLISION_DAMAGE;
    context.baseTierOfPower = system.baseTierOfPower ?? 1;
    context.hardnessRanks = HARDNESS_RANKS.map(hardness => ({
      rank: hardness.rank,
      text: hardness.text,
      material: hardness.material,
      value: hardnessValue(hardness.rank, context.baseTierOfPower),
      // Which one the Cover picker opens on. The same list serves both, because a Rank is
      // a Rank whether you are behind it or walking into it.
      behind: hardness.rank === (system.battlefield?.cover?.rank ?? 0)
    }));

    // The Feature Qualities, for reading. Flattened here rather than reached into from
    // the page, because a template cannot ask whether a key exists without one.
    context.featureQualities = FEATURE_QUALITIES.map(quality => ({
      name: quality.name,
      text: quality.text,
      note: quality.note ?? "",
      onCollision: Boolean(quality.collision)
    }));

    context.featureAttacks = this.#ownedManeuvers()
      .filter(maneuver => maneuver.attacking)
      .map(maneuver => ({ itemId: maneuver.itemId, name: maneuver.name }));

    context.weather = weatherTiers
      ? {
          tiers: weatherTiers,
          // The template pluralises off this rather than off the number, the way the
          // Charging row does.
          one: weatherTiers === 1,
          note: `Battle Weathers count ${weatherTiers} Tier`
            + `${weatherTiers === 1 ? "" : "s"} lower for you. A Tier reduced to 0 is a `
            + "Battle Weather that does nothing to you. Said here rather than applied: "
            + "this system has no Battle Weathers to take it off."
        }
      : null;

    context.grapple = this.#grapple();
    context.states = statesFor(this.actor);
    const entered = context.states.filter(s => s.active);
    context.anyState = entered.length > 0;
    context.stateSummary = entered
      .map(s => (s.levelled ? `${s.name} ${s.level}` : s.name))
      .join(", ");

    context.karmaMax = DBUCharacterData.KARMA_MAX;
    context.racialTraits = this.#racialTraitChoices();

    // What is being charged, if anything. Named rather than shown as an id, since the
    // point of saying it is that the reader knows which attack is waiting.
    // What is being held back by the Triggered Maneuver, if anything. Said on the sheet
    // because the trigger is in the player's own words and nothing watches for it - the
    // table has to be able to read what they are waiting on.
    context.delayed = delayedManeuver(this.actor);

    const charging = this.actor.system.charging;
    context.charging = charging?.maneuverId
      ? {
          name: this.actor.items.get(charging.maneuverId)?.name ?? "an Attacking Maneuver",
          profile: PROFILES[charging.profile]?.label ?? "",
          charges: charging.charges,
          one: charging.charges === 1
        }
      : null;
    // Only what the character actually holds; a talent whose definition is missing is
    // dropped rather than shown as a blank row.
    // Armed per **effect**, not per Talent. A Talent carrying two triggered effects
    // could not have them armed or spent separately before, because both the armed list
    // and the use counters were keyed on the Talent itself.
    const triggered = reactiveFor(this.actor);
    context.talents = ownedTalents(this.actor).map(item => ({
      item,
      triggered: triggered
        .filter(entry => (entry.sourceId === item.id) && entry.budget)
        .map(entry => ({
          id: entry.blockId,
          armed: entry.armed,
          available: entry.available,
          round: entry.uses.round,
          encounter: entry.uses.encounter,
          text: entry.program.blocks[0]?.text ?? ""
        }))
    }));
    context.isGM = game.user.isGM;

    const { capacity } = this.actor.system;
    context.capacityPercent = DBUCharacterSheet.#percentFull({
      value: capacity.spent,
      max: capacity.max
    });
    context.skillGroups = this._prepareSkillGroups(context.workings);
    context.maneuverGroups = this._prepareManeuverGroups();
    context.racialSkillRanks = this._prepareRacialSkillRanks();
    context.racialAttributeChoices = this._prepareRacialAttributeChoices();
    const { race, subrace } = this.actor.system;
    context.raceOptions = raceOptions().map(option => ({
      ...option,
      selected: option.value === race
    }));
    // Only the Character Creation Sizes are offered, plus whatever the character is
    // already set to - an effect may have moved them somewhere not on that list, and
    // rendering it as absent would silently drop it on the next save.
    const { size } = this.actor.system;
    context.sizeOptions = Object.entries(DBUCharacterData.SIZES)
      .filter(([key, definition]) => definition.selectable || (key === size.key))
      .map(([key, definition]) => ({
        value: key,
        label: definition.label,
        selected: key === size.key
      }));

    context.raceName = raceOptions().find(option => option.value === race)?.label ?? "";
    // Only races that define subraces offer the choice at all.
    context.subraceOptions = raceSubraces(race).map(option => ({
      value: option.id,
      label: option.name,
      selected: option.id === subrace
    }));
    context.subraceName = subraceName(race, subrace);
    return context;
  }

  /**
   * The Attribute increases the race leaves up to the player. Each choice offers
   * either a short list of Attributes or a free pick; an Attribute already taken by
   * another choice is unavailable, as is one excluded by the race's own rules - the
   * Bio Android, for instance, may not take both Force and Magic.
   */
  _prepareRacialAttributeChoices() {
    const { race, racialAttributeChoices: chosen } = this.actor.system;
    const attributes = Object.keys(this.actor.system.attributes);
    const exclusive = exclusiveAttributeGroups(race);

    return racialAttributeChoices(race).map((choice, index) => {
      const value = chosen[index] ?? "";
      const options = (choice.options === "any") ? attributes : choice.options;
      const takenElsewhere = chosen.filter((pick, i) => (i !== index) && pick);

      return {
        name: `system.racialAttributeChoices.${index}`,
        amount: choice.amount,
        value,
        options: options.map(key => {
          // Blocked when another choice already took this Attribute, or took one
          // that cannot be combined with it.
          const blocked = takenElsewhere.some(pick => {
            return (pick === key)
              || exclusive.some(group => group.includes(pick) && group.includes(key));
          });
          return {
            value: key,
            label: DBUCharacterData.ATTRIBUTE_ABBREVIATIONS[key] ?? key,
            selected: key === value,
            disabled: (key !== value) && blocked
          };
        })
      };
    });
  }

  /**
   * The Skill Rank slots granted by the character's race. These are earned at Power
   * Level 1, so they are capped by the Tier 1 limit, and the same Skill cannot be
   * picked twice within them.
   */
  _prepareRacialSkillRanks() {
    const { SKILLS } = DBUCharacterData;
    const chosen = this.actor.system.racialSkillRanks;
    const rankCap = DBUCharacterData.skillRankCap(DBUCharacterData.tierOfPowerFor(1));

    const progression = this.actor.system.progression;

    return Array.from({ length: racialSkillRankCount(this.actor.system.race) }, (unused, slot) => {
      const value = chosen[slot] ?? "";
      return {
        name: `system.racialSkillRanks.${slot}`,
        value,
        options: Object.entries(SKILLS).map(([key, skill]) => {
          // Racial Ranks are all granted at once, so a Skill taken by a sibling slot
          // would be a second Rank in the same grant - which the rules disallow.
          const takenBySibling = chosen.some((pick, i) => (i !== slot) && (pick === key));

          // A racial Rank is earned at Power Level 1, so it comes before every Skill
          // Improvement. Taking one here can therefore push Ranks that were already
          // spent in the table past the cap of the Tier they were earned at, which
          // makes this Skill unavailable until one of those is freed.
          const proposed = chosen.map((pick, i) => (i === slot) ? key : pick);
          const overflows = !DBUCharacterData.rankSequenceIsLegal(key, proposed, progression);

          return {
            value: key,
            label: overflows ? `${skill.label} (cap ${rankCap})` : skill.label,
            selected: key === value,
            disabled: (key !== value) && (takenBySibling || overflows)
          };
        }),
        rankCap
      };
    });
  }

  /**
   * The Grapple this character is in, if they are in one.
   *
   * Which half of it they are is most of what matters: the Grappler ends it, the
   * Grappled has to win a Grapple Check to get out, and neither can do the other's
   * half. So the row says which they are rather than leaving it to be worked out from
   * which button is showing.
   */
  #grapple() {
    const { partner, role, escapeActions = 0 } = this.actor.system.grapple ?? {};
    if (!partner || !role) return null;

    const other = fromUuidSync(partner);
    return {
      role,
      grappler: role === "grappler",
      // What the attempts already made this turn are worth to the next one, which is the
      // one thing worth knowing before spending another Action on it.
      tried: escapeActions,
      nextBonus: escapeActions * Math.max(1, this.actor.system.tierOfPower ?? 1),
      // A partner whose token has gone leaves a Grapple with nobody in it. Said rather
      // than drawn as a blank, and the button still works - letting go of nothing is
      // how you get out of it.
      name: other?.name ?? "somebody who is no longer here",
      actions: actionsLeft(this.actor, "standard")
    };
  }

  /** The Grappler lets go. An Instant Maneuver, on their turn. */
  static async _onReleaseGrapple() {
    return releaseGrapple(this.actor);
  }

  /** The Grappled spends an Action on a Grapple Check to break free. */
  static async _onEscapeGrapple() {
    return escapeGrapple(this.actor);
  }

  /**
   * The Maneuvers a character can reach from this tab, grouped by type.
   *
   * Standard and Instant Maneuvers are played from here. Counter Maneuvers are listed
   * for reference only: they answer an Attacking Maneuver, so they are played from
   * that attack's message in chat rather than from the sheet.
   *
   * Out-of-Sequence Maneuvers are left out altogether - they never sit in a list
   * waiting to be used, only appearing where an effect grants one.
   */
  _prepareManeuverGroups() {
    // An Instant Maneuver cannot follow another Instant, and the one rule that says so
    // is asked rather than reconstructed here - the sheet used to work it out a second
    // way, and the two did not agree.
    const blocked = whyNotAnotherInstant(this.actor);

    const groups = [
      { key: "standard", playable: true },
      {
        key: "instant",
        playable: !blocked,
        note: blocked ?? ""
      },
      { key: "counter", playable: false, note: "Played from the attack they answer, in chat" },
      // Never played from here, and listed anyway: an Out-of-Sequence Maneuver exists
      // only as a chance something that just happened handed you, and the row is still
      // where a player reads what their own Maneuver does.
      { key: "outOfSequence", playable: false,
        note: "Played from the card of whatever offered it" },
      // Applied onto another Maneuver rather than used, so never played from here either.
      // The row is where a player reads what their own Modifier does, and what it says it
      // applies to.
      { key: "modifier", playable: false,
        note: "Applied to another Maneuver as you use that one" }
    ];

    return groups
      .map(group => ({
        ...group,
        label: MANEUVER_TYPES[group.key].label,
        // Open unless the player has closed it. Rendered rather than restored after the
        // fact, so the section never changes height once the scroll has been set.
        open: this.#openSections[`maneuvers-${group.key}`] ?? true,
        // The character's own Maneuver Items, not a shared table: Signature Techniques
        // and Unique Abilities are bought per character, so they could never have lived
        // in one.
        maneuvers: this.#ownedManeuvers()
          .filter(maneuver => maneuver.type === group.key)
          // A Maneuver nothing has opened yet is not listed. The Item is still theirs -
          // renamed, edited, whatever they have done to it - and it comes back the moment
          // whatever opens it is true again.
          .filter(maneuver => !this.#notYetOpen(maneuver))
          .map(maneuver => ({
            ...maneuver,
            // The cost as it will really be charged: `kiCost` on its own misses the
            // "2(bT)" notation and misses any discount an effect applies, so a
            // Maneuver priced that way showed as free.
            kiCost: maneuverKiCost(maneuver, null, this.actor),
            usageLabel: usageLimitLabel(maneuver),
            usesLeft: maneuverUsesLeft(this.actor, maneuver),
            // Off the group, unless the Maneuver has a reason of its own to be here.
            playable: (group.playable || this.#playableAlone(maneuver))
              && !this.#playedThrough(maneuver)
              && !this.#withoutAccess(maneuver),
            // Two different ways to be unable to play it, and the row says which:
            // out of uses is a limit of the Maneuver, out of Actions is a limit of
            // the round. Seen before clicking rather than after.
            exhausted: maneuverUsesLeft(this.actor, maneuver) <= 0,
            unaffordable: this.#shortOfActions(maneuver),
            // What opens under the row: this character's description, then the
            // published entry. Rendered already open if it was left open, so the list
            // does not change height after the fact.
            ...maneuverEntry(maneuver),
            open: Boolean(this.#openSections[`maneuver-${maneuver.itemId}`]),
            // And why it cannot be played, if it cannot. Said as well as the entry
            // rather than instead of it: replacing the text answered "why is this
            // greyed out" at the cost of answering "what does it do".
            notes: [
              maneuverUsesLeft(this.actor, maneuver) <= 0
                ? `No uses of this left this ${maneuver.usageLimit?.per ?? "encounter"}.`
                : "",
              this.#shortOfActions(maneuver) ? "No Actions left this round for this." : "",
              this.#playedThrough(maneuver),
              this.#withoutAccess(maneuver),
              group.playable || this.#playableAlone(maneuver)
                ? ""
                : (maneuver.type === "outOfSequence")
                ? "Played from the card of whatever offers it - nothing takes one from here."
                : (maneuver.type === "modifier")
                ? `Applied to ${(maneuver.baseManeuver ?? []).join(" or ") || "nothing yet"}`
                  + " when you use it, and offered as you declare that Maneuver."
                : "Played from the attack it answers, in chat."
            ].filter(Boolean),
            // Instant and Counter Maneuvers spend no Standard Action, so what they
            // cost is worth showing per type rather than assuming.
            actionLabel: MANEUVER_TYPES[maneuver.type].action
              ? `${maneuver.actionCost} ${MANEUVER_TYPES[maneuver.type].action}`
              : "—"
          }))
      }))
      .filter(group => group.maneuvers.length > 0);
  }

  /**
   * Group the derived Skills under the Attribute that governs them, in the order the
   * Attributes themselves are listed. Force and Tenacity govern none, so they are
   * left out rather than shown empty.
   */
  _prepareSkillGroups(workings = {}) {
    // Each Skill carries the table for its own roll. The roll, not the Bonus: what the
    // sheet shows is what the button rolls, and the Bonus is a row inside it.
    const skills = Object.values(this.actor.system.skills)
      .map(skill => ({ ...skill, workings: workings[`skill.${skill.key}`] ?? "" }));
    return Object.keys(this.actor.system.attributes)
      .map(attribute => ({
        attribute,
        label: attribute.charAt(0).toUpperCase() + attribute.slice(1),
        skills: skills.filter(skill => skill.attribute === attribute)
      }))
      .filter(group => group.skills.length > 0);
  }

  /**
   * Flatten each progression row into the flags the template needs, so the markup
   * does not have to nest conditionals. Each option unlocks exactly one column and
   * fixes the rest: Attribute Addition the stat cells, Talent Addition the talent,
   * Skill Improvement the rank slots. Character Perk unlocks none of them, and TP is
   * always derived from the option rather than entered by hand.
   */
  _prepareProgressionRows() {
    const { SKILLS } = DBUCharacterData;
    // A Talent Addition row records which of the character's Talents was taken at that
    // Level. The Talents themselves are the Items they own, not these rows.
    const talents = ownedTalents(this.actor).map(item => ({ value: item.id, label: item.name }));

    const powerLevel = this.actor.system.powerLevel;
    const progression = this.actor.system.progression;

    // Ranks already committed to each Skill *before* each row, walking the table in
    // level order. A Rank must have been legal when it was earned, so the cap for a
    // row is the one for its own Level's Tier of Power, applied to the Ranks that
    // existed at that point - reaching a higher Level later does not retroactively
    // legalise an assignment. This tally therefore ignores the current Power Level.
    const ranksBeforeRow = [];
    const tally = {};
    for (const key of this.actor.system.racialSkillRanks) {
      if (key) tally[key] = (tally[key] ?? 0) + 1;
    }
    for (const entry of progression) {
      ranksBeforeRow.push({ ...tally });
      if (entry.choice !== "Skill Improvement") continue;
      for (const key of entry.skillRanks) {
        if (key) tally[key] = (tally[key] ?? 0) + 1;
      }
    }

    return progression.map((entry, index, rows) => {
      const isAttributeAddition = entry.choice === "Attribute Addition";
      const isSkillImprovement = entry.choice === "Skill Improvement";
      const isTalentAddition = entry.choice === "Talent Addition";

      return {
        entry,
        index,
        isAttributeAddition,
        isSkillImprovement,
        isTalentAddition,
        // A level spans several rows; mark the first so the table can rule them off.
        firstOfLevel: (index === 0) || (rows[index - 1].lvl !== entry.lvl),
        // Rows above the character's current Power Level are not earned yet and do
        // not count toward the TP total.
        reached: entry.lvl <= powerLevel,
        talentOptions: talents.map(option => ({ ...option, selected: option.value === entry.talent })),
        // The Level 1 Skill Improvement offers 6 rank slots; every other one offers 4.
        skillRanks: Array.from({ length: DBUCharacterData.skillRankSlotsFor(entry) }, (unused, slot) => {
          const value = entry.skillRanks[slot] ?? "";
          const rankCap = DBUCharacterData.skillRankCap(DBUCharacterData.tierOfPowerFor(entry.lvl));
          const prior = ranksBeforeRow[index];

          const otherSlots = entry.skillRanks.filter((pick, at) => at !== slot);

          return {
            name: `system.progression.${index}.skillRanks.${slot}`,
            value,
            options: Object.entries(SKILLS).map(([key, skill]) => {
              // A Skill Improvement spreads across distinct Skills, except for the two
              // extra Ranks the Level 1 one carries.
              const takenBySibling = !DBUCharacterData.canRepeatSkillRank(entry, key, otherSlots);
              // Nor can it push a Skill past the cap of this row's Tier of Power. The
              // Ranks already spent on it in this same grant count too - without them a
              // racial Rank plus a pair here would quietly reach three.
              const takenInRow = otherSlots.filter(pick => pick === key).length;
              const atCap = ((prior[key] ?? 0) + takenInRow + 1) > rankCap;

              return {
                value: key,
                label: atCap ? `${skill.label} (cap ${rankCap})` : skill.label,
                selected: key === value,
                // The current value stays selectable so the row can still show it.
                disabled: (key !== value) && (takenBySibling || atCap)
              };
            })
          };
        })
      };
    });
  }

  /** Build the tab configuration used by the "tabs" part template. */
  _getTabs() {
    const tabs = {};
    for (const [key, tab] of Object.entries(this.constructor.TABS)) {
      tabs[key] = {
        ...tab,
        active: this.tabGroups[tab.group] === key,
        cssClass: this.tabGroups[tab.group] === key ? "active" : ""
      };
    }
    return tabs;
  }

  /**
   * Handle clicking an Attribute label to roll 1d10 + Attribute Modifier.
   * Registered via DEFAULT_OPTIONS.actions, per the ApplicationV2 action convention.
   */
  static async _onAttributeRoll(event, target) {
    const key = target.dataset.attribute;
    const attribute = this.actor.system.attributes[key];
    const label = key.charAt(0).toUpperCase() + key.slice(1);
    const mod = attribute.mod >= 0 ? `+${attribute.mod}` : String(attribute.mod);

    // Every roll opens the same window, even when a willing failure is the only thing
    // there is to declare: it is decided here, at the roll, rather than armed in
    // advance and waiting to catch a later one.
    const ready = await prepareRoll(
      this.actor, [], `${label} Check`,
      `Roll <strong>${label}</strong>? (${DBUCharacterData.BASE_DIE} ${mod})`
    );
    if (!ready) return;

    // Not a Skill roll, so the critical uses the character's Critical Extra Dice.
    return this.#rollCheck({
      parts: [{ label, value: attribute.mod }],
      flavor: `${label} Check`,
      criticalDice: this.actor.system.dice.critical.formula
    });
  }

  /**
   * Roll a Saving Throw.
   *
   * A Saving Throw is its own category of roll - not a Combat Roll and not a Skill - so
   * it takes the character's own Critical Extra Dice and the Botch penalty that goes
   * with everything that is not a Skill.
   */
  static async _onSaveRoll(event, target) {
    const key = target.dataset.save;
    const save = this.actor.system.savingThrows[key];
    if (!save) return;

    const ready = await prepareRoll(
      this.actor, [], `${save.label} Saving Throw`,
      `Roll <strong>${save.label}</strong>? (${DBUCharacterData.BASE_DIE} +${save.value})`
    );
    if (!ready) return;

    return this.#rollCheck({
      parts: [{ label: save.label, value: save.value }],
      flavor: `${save.label} Saving Throw`,
      criticalDice: this.actor.system.dice.critical.formula,
      // A racial Saving Throw "crits one point more easily". The data model has worked
      // that out for every Saving Throw since they were built, and nothing had ever read
      // it - so the racial half of the rule did nothing at all.
      criticalTarget: save.criticalTarget
    });
  }

  /**
   * Roll Initiative from the sheet.
   *
   * Handed to the Combat if this character is in one, so the Tracker takes the result
   * rather than the table having to read a number off a card and type it in. Outside a
   * Combat it is rolled as a plain check, which is what the button can honestly do.
   */
  static async _onInitiativeRoll() {
    const combatant = game.combat?.combatants?.find(c => c.actor?.uuid === this.actor.uuid);

    // An Initiative Check is Urgent, so it cannot be failed on purpose.
    const ready = await prepareRoll(
      this.actor, [], "Initiative",
      `Roll <strong>Initiative</strong>? (${DBUCharacterData.BASE_DIE} `
        + `+${this.actor.system.initiativeBonus})`,
      { urgent: true }
    );
    if (!ready) return;

    if (combatant) return game.combat.rollInitiative([combatant.id]);

    return this.#rollCheck({
      parts: [{ label: "Initiative", value: this.actor.system.initiativeBonus }],
      flavor: "Initiative",
      criticalDice: this.actor.system.dice.critical.formula,
      urgent: true
    });
  }

  /**
   * Whether this Maneuver can be played from the sheet despite its group.
   *
   * Only Energy Cancel so far. Its group is played from the card of the attack it
   * answers, and it can be too - but the rule also allows it "at the start of your
   * turn", and there is no card for that.
   */
  #playableAlone(maneuver) {
    return Boolean(maneuver.cancelCharge) && Boolean(this.actor.system.charging?.maneuverId);
  }

  /**
   * Why this Special Maneuver cannot be used yet, if it cannot.
   *
   * "You cannot use any Special Maneuvers until you have gained access to them through an
   * effect." Owning the Item is not access - it is on the sheet, and what the rule asks
   * for is an effect that grants it - so the row is drawn, greyed, and says what is
   * missing rather than being left off the list.
   */
  /**
   * Whether this Maneuver is one the character has but cannot yet reach.
   *
   * Two ways to be that, and both mean the same thing to the list: the row is not drawn.
   *
   *   - a Special Maneuver nothing has opened. "You cannot use any Special Maneuvers until
   *     you have gained access to them through an effect" - so until something has, the
   *     list is not the place to read about it.
   *   - a Maneuver that is one of a Trait's own numbered effects, while that Trait is not
   *     on them. The Liquid State's sixth effect is a Maneuver only while you are Liquid.
   *
   * The Item is never taken away, which is the point: a player who renames theirs finds it
   * under that name the next time it opens, rather than finding a fresh one.
   */
  #notYetOpen(maneuver) {
    if (maneuver.fromTrait && !traitActive(this.actor, maneuver.fromTrait)) return true;
    return Boolean(whyNotSpecial(this.actor, maneuver));
  }

  #withoutAccess(maneuver) {
    return whyNotSpecial(this.actor, maneuver) ?? "";
  }

  /**
   * Why this Maneuver is not played from its own row, if it is not.
   *
   * A Signature Technique is the one case. It is a Maneuver the character owns and it
   * appears in the Standard list like any other, but it is not used on its own: the
   * Signature Technique Maneuver is what costs the Action and carries the [1/Round],
   * and a row that threw the Technique directly would be a second way in with no limit
   * behind it.
   *
   * Said rather than hidden. The row is still worth having - it is where the player
   * reads what their own Technique does.
   */
  #playedThrough(maneuver) {
    const technique = (maneuver.tags ?? []).includes("signature")
      && !maneuver.signatureTechnique;
    return technique ? "Played through the Signature Technique Maneuver." : "";
  }

  /**
   * Whether the round has run out of the Actions this Maneuver would cost.
   *
   * Only inside a Combat Encounter: outside one there are no rounds, so nothing has
   * been spent and nothing can be short.
   */
  #shortOfActions(maneuver) {
    if (!game.combat?.started) return false;

    const type = MANEUVER_TYPES[maneuver.type];
    if (!type?.action) return false;

    return actionsLeft(this.actor, type.action) < (maneuver.actionCost ?? 1);
  }

  /** Maximum attribute points a single "Attribute Addition" row may distribute. */
  static ATTRIBUTE_ADDITION_MAX = 2;

  /** @override */
  _onRender(context, options) {
    super._onRender(context, options);

    // An "Attribute Addition" row may spread at most 2 points across its seven
    // attribute cells, and no cell may leave the 0-2 range. The `min`/`max`
    // attributes only constrain the spinner arrows - typed and pasted values are
    // not enforced by the browser - so clamp on every keystroke instead, and keep
    // each cell's `max` in step with the points still unspent in that row.
    for (const row of this.element.querySelectorAll(".progression-table tr[data-attribute-addition]")) {
      this.#applyAttributeAdditionLimits(row);
      for (const input of row.querySelectorAll(".attr-input")) {
        input.addEventListener("input", () => this.#onAttributeAdditionInput(row, input));
      }
    }

    // Recorded, not re-rendered: opening a section is a local thing, and re-rendering
    // to record it would be the very jump this is here to avoid.
    for (const details of this.element.querySelectorAll("details[data-section]")) {
      details.addEventListener("toggle", () => {
        this.#openSections[details.dataset.section] = details.open;
      });
    }

    for (const handler of this.#dragDrop) handler.bind(this.element);
    this.#bindActionTotals();
    this.#bindRange('input[name="system.powerLevel"]', 1, DBUCharacterData.MAX_POWER_LEVEL);
    // Clearing the field falls back to 10, not to the 7 minimum - an emptied field
    // must not hand out the best possible Critical Target.
    this.#bindRange(
      'input[name="system.criticalTarget"]',
      DBUCharacterData.CRITICAL_TARGET_MIN,
      DBUCharacterData.CRITICAL_TARGET_DEFAULT,
      DBUCharacterData.CRITICAL_TARGET_DEFAULT
    );
  }

  /**
   * Let the unlocked Combat tab set how many Actions a character has this round.
   *
   * What is stored is the modifier, not the total, since the total is derived - so a
   * typed total is turned back into the adjustment that produces it.
   */
  #bindActionTotals() {
    const bases = {
      standard: DBUCharacterData.BASE_STANDARD_ACTIONS,
      counter: DBUCharacterData.BASE_COUNTER_ACTIONS
    };

    for (const input of this.element.querySelectorAll("input[data-action-type]")) {
      input.addEventListener("change", () => {
        const type = input.dataset.actionType;
        const total = Math.max(0, Math.floor(Number(input.value)) || 0);
        this.actor.update({ [`system.actionModifiers.${type}`]: total - bases[type] });
      });
    }
  }

  /**
   * Keep a numeric field within a range. The upper bound is applied while typing, but
   * the lower bound only on commit: clamping an empty field up mid-edit would fight
   * the user as they clear it to type a new value.
   */
  #bindRange(selector, min, max, fallback = min) {
    const input = this.element.querySelector(selector);
    if (!input) return;

    input.addEventListener("input", () => {
      const value = Math.floor(Number(input.value));
      if (Number.isFinite(value) && (value > max)) input.value = String(max);
    });

    input.addEventListener("change", () => {
      const value = Math.floor(Number(input.value));
      const clamped = Number.isFinite(value) ? Math.min(Math.max(value, min), max) : fallback;
      if (input.value !== String(clamped)) input.value = String(clamped);
    });
  }

  /** How full a resource pool is, as a 0-100 width for its meter. */
  static #percentFull({ value, max }) {
    if (!max) return 0;
    return Math.min(100, Math.max(0, Math.round((value / max) * 100)));
  }

  /** Read an attribute cell as a non-negative integer, treating blank/invalid as 0. */
  static #cellValue(input) {
    const value = Math.floor(Number(input.value));
    return Number.isFinite(value) ? Math.max(0, value) : 0;
  }

  /** Clamp the edited cell so its row never exceeds the row budget, then refresh the caps. */
  #onAttributeAdditionInput(row, input) {
    const cells = [...row.querySelectorAll(".attr-input")];
    const spentElsewhere = cells
      .filter(cell => cell !== input)
      .reduce((sum, cell) => sum + DBUCharacterSheet.#cellValue(cell), 0);
    const allowed = Math.max(0, DBUCharacterSheet.ATTRIBUTE_ADDITION_MAX - spentElsewhere);
    const clamped = Math.min(DBUCharacterSheet.#cellValue(input), allowed);
    if (input.value !== String(clamped)) input.value = String(clamped);
    this.#applyAttributeAdditionLimits(row);
  }

  /**
   * Cap every cell in the row at its own value plus whatever is left of the budget.
   * Once the row totals 2, cells sitting at 0 get a max of 0 and cannot be raised.
   */
  #applyAttributeAdditionLimits(row) {
    const cells = [...row.querySelectorAll(".attr-input")];
    const spent = cells.reduce((sum, cell) => sum + DBUCharacterSheet.#cellValue(cell), 0);
    const remaining = Math.max(0, DBUCharacterSheet.ATTRIBUTE_ADDITION_MAX - spent);
    for (const cell of cells) {
      cell.min = "0";
      cell.max = String(DBUCharacterSheet.#cellValue(cell) + remaining);
    }
  }

  /** GM only: put the published Talents in the compendium to drag from. */
  static async _onImportTalents() {
    return importCoreTalents();
  }

  /**
   * GM only: read every Talent back from its file.
   *
   * Importing leaves an existing Talent alone, because a GM may have edited it. This is
   * how to say "take the file's version instead" - on a button, so an edit is never
   * lost by surprise.
   */
  static async _onReloadTalents() {
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: "Reload Talents from files" },
      content: "<p>Every core Talent will be overwritten with what its file says. "
             + "Edits made in Foundry to those Talents are lost. Continue?</p>",
      modal: true,
      rejectClose: false
    });
    if (!confirmed) return;
    return reloadCoreTalents();
  }

  /** GM only: put the published Maneuvers in the compendium to drag from. */
  static async _onImportManeuvers() {
    return importCoreManeuvers();
  }

  /**
   * Give this character the Core Maneuvers they are missing.
   *
   * New characters get them when they are created, but one made before Maneuvers became
   * Items has none - and without this there would be no way to hand them over except by
   * dragging six things out of a compendium.
   */
  static async _onGrantManeuvers() {
    const held = new Set(this.actor.items
      .filter(item => item.type === "maneuver")
      .map(item => item.system.maneuverId || item.name));

    const missing = coreManeuverItems()
      .filter(entry => !held.has(entry.system.maneuverId) && !held.has(entry.name));

    if (!missing.length) {
      ui.notifications.info(`${this.actor.name} already has every core Maneuver.`);
      return;
    }

    await this.actor.createEmbeddedDocuments("Item", missing);
    ui.notifications.info(`Gave ${this.actor.name} ${missing.length} core Maneuver(s).`);
  }

  /**
   * Arm or disarm a triggered talent effect for the next Combat Roll.
   *
   * Armed ahead of the roll rather than offered during it: the client that resolves an
   * exchange is often not the one that owns the character rolling, so there is no
   * moment mid-roll at which the owner could be asked.
   */
  static async _onArmTalent(event, target) {
    // The id names one effect of one Talent, so two triggered effects on the same
    // Talent are armed independently.
    const id = target.dataset.effectId ?? target.dataset.itemId;
    const armed = this.actor.system.armedTalents;
    return this.actor.update({
      "system.armedTalents": armed.includes(id) ? armed.filter(other => other !== id) : [...armed, id]
    });
  }

  /**
   * Open or close what a Maneuver's row has to say.
   *
   * Bound to the row rather than to a control of its own, so anywhere on it works -
   * ApplicationV2 dispatches a click to `closest("[data-action]")`, which means the name
   * and the pencil keep their own clicks and everything else in the row lands here.
   *
   * Recorded and toggled in place rather than re-rendered: the list would jump, and
   * re-rendering a whole sheet to remember that somebody opened a row is the same
   * mistake the collapsible sections already avoid.
   */
  static _onToggleManeuver(event, target) {
    const row = target.closest(".maneuver");
    if (!row) return;

    const open = !row.classList.contains("maneuver-open");
    row.classList.toggle("maneuver-open", open);
    this.#openSections[`maneuver-${row.dataset.itemId}`] = open;
  }

  /** Open an owned Item's own sheet. */
  static _onEditItem(event, target) {
    this.actor.items.get(target.dataset.itemId)?.sheet.render(true);
  }

  /** Remove an owned Item from this character. */
  static async _onDeleteItem(event, target) {
    return this.actor.items.get(target.dataset.itemId)?.delete();
  }

  /**
   * What a Condition lets you do about it, as buttons.
   *
   * Standing up from Prone and clashing free of Pinned are both written as triggered
   * effects that cost an Action. They are the character's choice to make, so they need
   * somewhere to be chosen - and the Action cost is checked here rather than after,
   * because a button that spends an Action you do not have is worse than a greyed one.
   */
  #conditionAbilities() {
    return reactiveFor(this.actor)
      .filter(entry => entry.sourceId.startsWith("condition:"))
      .flatMap(entry => (entry.program.blocks ?? [])
        .filter(b => b.budget?.actions)
        .map(b => {
          const cost = b.budget.actions;

          // Both of these are spent "during your turn", and outside an Encounter there
          // are no turns to be out of - so the restriction only bites where it means
          // something.
          const inCombat = Boolean(game.combat?.started);
          const theirTurn = !inCombat || isTheirTurn(this.actor);
          const affordable = actionsLeft(this.actor, "standard") >= cost;

          const refusal = !theirTurn
            ? "This can only be done during your own turn."
            : (!affordable ? "Not enough Actions left this round." : null);

          return {
            sourceId: entry.sourceId,
            block: b.index,
            label: `${entry.sourceName} (${cost} Action${cost === 1 ? "" : "s"})`,
            affordable: !refusal,
            tooltip: refusal ?? entry.sourceName
          };
        }));
  }

  /**
   * The Racial Traits this character's race offers, and which of them they have.
   *
   * Filtered by race rather than listing them all: a Saiyan has no business being
   * offered an Android's. Empty until a race has Traits written for it, and the section
   * says so rather than appearing as an empty box.
   */
  #racialTraitChoices() {
    const race = this.actor.system.race;
    if (!race) return [];

    const taken = new Set(this.actor.system.racialTraits ?? []);
    return traitsOfKind("races", race).map(trait => ({
      id: trait.id,
      name: trait.name,
      text: trait.text || trait.description || "",
      taken: taken.has(trait.id)
    }));
  }

  /** Take a Racial Trait, or give it up. */
  static async _onToggleRacialTrait(event, target) {
    const id = target.dataset.trait;
    const taken = new Set(this.actor.system.racialTraits ?? []);

    if (taken.has(id)) taken.delete(id);
    else taken.add(id);

    return this.actor.update({ "system.racialTraits": [...taken] });
  }

  /** Enter or leave a State. */
  static async _onToggleState(event, target) {
    return toggleState(this.actor, target.dataset.state);
  }

  /** One level higher or lower in a State that has levels. */
  static async _onStepState(event, target) {
    const key = target.dataset.state;
    const step = Number(target.dataset.step) || 0;
    const current = Number(this.actor.system.states?.[key]) || 0;
    return setState(this.actor, key, current + step);
  }

  /** Put a Combat Condition on this character, or take it off. */
  static async _onToggleCondition(event, target) {
    return toggleCondition(this.actor, target.dataset.condition);
  }

  /** One more or one fewer stack of a stacking Combat Condition. */
  static async _onStepCondition(event, target) {
    const key = target.dataset.condition;
    const step = Number(target.dataset.step) || 0;
    const current = Number(this.actor.system.conditions?.[key]) || 0;
    return setCondition(this.actor, key, current + step);
  }

  /**
   * Use what a Condition offers - standing up, or clashing free.
   *
   * The Action is spent first: if it cannot be paid for, nothing should fire. Arming the
   * block is what makes the effect eligible, since it is triggered rather than automatic.
   */
  static async _onUseConditionAbility(event, target) {
    const { source, block } = target.dataset;
    const entry = reactiveFor(this.actor)
      .find(e => (e.sourceId === source) && (e.blockId === `${source}#${block}`));
    if (!entry) return;

    const cost = entry.program.blocks?.[0]?.budget?.actions ?? 0;
    if (!await spendActions(this.actor, cost, "standard")) return;

    // Armed for exactly this, then fired. It is disarmed again by fireMoment when the
    // use is recorded, so a second press has to pay for itself.
    await this.actor.update({
      "system.armedTalents": [...this.actor.system.armedTalents, entry.blockId]
    });

    // Narrowed to this Condition: pressing "stand up" must not also spend whatever else
    // the character had armed for the same Moment.
    const moment = entry.program.blocks?.[0]?.moment;
    const { fired } = await fireMoment(
      this.actor,
      moment,
      { condition: source.slice("condition:".length) },
      { only: source }
    );

    // Judged by whether anything answered, not by what it came to. Standing up from
    // Prone is a verb and changes no Slot, so measuring the Slots said it had failed -
    // and then handed the Action back for something that had in fact happened.
    if (!fired) {
      const { refundActions } = await import("../combat.mjs");
      await refundActions(this.actor, cost, "standard");
      ui.notifications.warn(`${entry.sourceName} could not be used right now.`);
    }
  }

  /** Spend or regain a Karma Point. */
  static async _onStepKarma(event, target) {
    const step = Number(target.dataset.step) || 0;
    const wanted = (this.actor.system.karma ?? 0) + step;
    return this.actor.update({
      "system.karma": Math.min(DBUCharacterData.KARMA_MAX, Math.max(0, wanted))
    });
  }

  /** Unlock or re-lock the Combat tab's tracking values. */
  static _onToggleCombatEdit() {
    this.#combatEditMode = !this.#combatEditMode;
    this.render();
  }

  /**
   * Turn the Combat Round over by hand.
   *
   * A Combat does this on its own now, so this is for a table playing without a formal
   * Encounter - and for putting things right when one gets out of step. It clears
   * exactly what a round clears, from the same list, so the two cannot say different
   * things about what a new round means.
   */
  static async _onResetCapacity() {
    return this.actor.update(newRoundFor(this.actor));
  }

  /**
   * Settle the Steadfast Checks owed for the Thresholds crossed.
   *
   * Crossing several at once is Massive Damage: every Threshold passed through is an
   * automatic failure except the lowest, which is the only one actually rolled for.
   */
  static async _onSteadfastCheck() {
    // The rule itself lives in chat.mjs, because two places ask for it now: this button
    // and the card posted when somebody is knocked through a Threshold. Written twice it
    // would drift, and the two would disagree about what a Check costs.
    return rollSteadfastCheck(this.actor);
  }

  /** Clear what only refreshes between Combat Encounters. */
  /**
   * Take the start of the Combat Encounter, once.
   *
   * For somebody who walked into an Encounter already under way: it began for everyone
   * else when it began, and it begins for them now. The rule itself lives in chat.mjs,
   * beside the card that offers the same thing to everyone who was already there.
   */
  static async _onEnterEncounter() {
    return enterEncounter(this.actor);
  }

  static async _onResetEncounter() {
    return this.actor.update({
      "system.usedManeuvers": [],
      "system.talentUses.encounter": [],
      // A new Encounter begins for them again, so the start of it is theirs to take
      // once more. A table not running a formal Encounter reaches it only this way.
      "system.enteredEncounter": false,
      "system.armedTalents": []
    });
  }

  /**
   * Use a Maneuver: pay for it and announce it. A Standard Maneuver is announced as
   * respondable, so other players can answer it with an Instant Maneuver.
   */
  static async _onUseManeuver(event, target) {
    // The same call the hotbar macro makes, so the two cannot drift apart.
    return useOwnedManeuver(this.actor, target.dataset.itemId ?? target.dataset.maneuver);
  }

  /**
   * Roll the Base Die plus a bonus and post it to chat.
   *
   * Whether a check crits or botches depends on the Base Die's own result, so neither
   * can be part of the formula. The roll is therefore posted as-is: a Botch reports
   * its adjusted total in the flavor, and a critical is flagged for the chat hook,
   * which offers the extra die as a button on the message (see chat.mjs).
   */
  async #rollCheck({ parts = [], flavor, criticalDice, skillRoll = false, urgent = false,
                    criticalTarget = null, difficulty = "" }) {
    // The Difficulty this Check is measured against, where it has one. Resolved once here
    // rather than looked up in each of the three branches below, all of which say whether
    // it was met - a willing failure that totals 0 has still missed a Target Number, and
    // saying nothing there would read as though the Difficulty had been forgotten.
    const against = DBUCharacterData.DIFFICULTIES[difficulty] ?? null;
    // Same rule as a Combat Roll: penalties cancel bonuses but never take a roll below
    // what the dice said - and what the floor hands back is shown rather than left for
    // the reader to discover by failing to add the column up.
    const netted = parts.reduce((sum, part) => sum + part.value, 0);
    const bonus = Math.max(0, netted);

    // Neither a Skill roll nor an Attribute Check is a Combat Roll, so only a Skill
    // roll loses the flat 2; everything else loses 2(bT).
    const botchPenalty = skillRoll
      ? (this.actor.system.botch?.skill ?? DBUCharacterData.BOTCH_PENALTY)
      : (this.actor.system.botch?.penalty ?? DBUCharacterData.BOTCH_PENALTY);
    // The Critical Target this roll is measured against, where it has one of its own:
    // a racial Saving Throw crits a point more easily, which is worked out per Saving
    // Throw and had nowhere to be read. Null means the character's own.
    const { roll, natural, botch, critical } =
      await evaluateCheck(this.actor, bonus, "", null, { criticalTarget });

    const speaker = ChatMessage.getSpeaker({ actor: this.actor });

    // The rows every other roll in the system is read as. A Skill Check used to show
    // Foundry's own dice tooltip and nothing about where the bonus came from, or - on a
    // Botch - a hand-built sentence quoting the raw formula. Same builders, same table.
    const rows = () => {
      const [base, ...extras] = roll.dice ?? [];
      const lines = [baseDieLine(base?.expression ?? DBUCharacterData.BASE_DIE,
        { rolled: natural, natural })];
      const dice = extraDiceLine(extras, "Extra dice");
      if (dice) lines.push(dice);
      for (const part of parts) if (part.value) lines.push(partLine(part));
      const held = floorLine(bonus - netted, bonus,
        "Penalties took the bonuses to nothing, and stop there");
      if (held) lines.push(held);
      return lines;
    };

    // What Karmic Chance needs to roll this again: the Base Die it got, what the roll
    // came to before that die's consequences, and which Botch penalty this kind of
    // roll uses. Carried on the message because the card outlives this call.
    const rerollable = {
      actorUuid: this.actor.uuid,
      natural,
      beforeOutcome: roll.total,
      criticalDice,
      botchPenalty,
      flavor
    };

    // A willing failure applies to any roll at all, this one included. It is decided
    // before the dice are read, so the total is 0 however they landed and neither a
    // Botch nor a critical is worked out - there is nothing left for either to change.
    // An Urgent roll cannot be thrown, and neither can one an effect is forcing. The
    // flag stays armed for whatever roll comes next that does allow it.
    if (this.actor.system.willingFailure && !whyNotWilling(this.actor, { urgent })) {
      await this.actor.update({ "system.willingFailure": false });
      await ChatMessage.create({
        speaker,
        flavor: `${flavor} — Willing failure`,
        rolls: [roll],
        content: checkCard({
          lines: [...rows(), noteLine("Willing failure - the total is 0"),
                  difficultyLine(0, against)].filter(Boolean),
          total: 0,
          outcome: "willing",
          owner: this.actor.uuid
        })
        // No `check` flag: a willing failure is a deliberate zero, and rerolling the
        // die it ignored would change nothing. The card marks its own owner, which is
        // all the hiding needs.
      });
      return;
    }

    if (botch) {
      // The penalty is certain, so the adjusted total is shown right away rather than
      // leaving the reader to subtract it from the card's number.
      // Floored at zero, as every other value is: the penalty cancels what the roll
      // came to rather than pushing it below nothing.
      const botched = Math.max(0, roll.total - botchPenalty);
      const lines = [
        ...rows(),
        // A Skill roll loses a flat 2; everything else loses 2(bT).
        partLine({
          label: "Botch",
          written: skillRoll ? "-2" : "-2(bT)",
          value: -botchPenalty,
          rank: "botch"
        }),
        // The Base Die's doing, like the Botch above it: a Karmic Chance that replaces
        // the die takes both rows with it.
        fromOutcome(floorLine(botched - (roll.total - botchPenalty), botched,
          "A Botch takes what it takes, and stops at nothing")),
        difficultyLine(botched, against)
      ].filter(Boolean);

      await ChatMessage.create({
        speaker,
        flavor: `${flavor} — Botch`,
        rolls: [roll],
        content: checkCard({ lines, total: botched, outcome: "botch", owner: this.actor.uuid }),
        flags: {
          "dbu-ttrpg": {
            check: { ...rerollable, total: botched, outcome: "botch", lines, against }
          }
        }
      });
      return botched;
    }

    // Posted as our own card rather than Foundry's, so a Skill Check is read the same
    // way as everything else. The Roll rides along on the message, which is what the
    // Critical Die button reaches for and what lets Foundry animate the dice.
    const lines = [...rows(), difficultyLine(roll.total, against)].filter(Boolean);
    await ChatMessage.create({
      speaker,
      flavor: critical ? `${flavor} — Critical` : flavor,
      rolls: [roll],
      content: checkCard({
        lines,
        total: roll.total,
        outcome: critical ? "critical" : "",
        owner: this.actor.uuid
      }),
      // Picked up by the chat hook, which offers the extra die as a button, and the
      // Karmic Chance button beside it.
      flags: {
        "dbu-ttrpg": {
          criticalPending: critical,
          criticalDice,
          check: {
            ...rerollable, total: roll.total, outcome: critical ? "critical" : "", lines,
            // Carried so the Critical Die's card can judge again: the extra die is exactly
            // the thing that can take a Check over a Target Number it had missed.
            against
          }
        }
      }
    });

    // What the Check came to. Every caller until now threw it away, and the Survival Check
    // an Unbreathable Environment asks for is the first that needs it: the Dice Score is
    // what buys the stacks of Held Breath.
    //
    // The Critical Die is a button on the card rather than part of this total, so what
    // comes back is the Check as it stands - which is what a Difficulty is read against
    // everywhere else too.
    return roll.total;
  }

  /**
   * Handle clicking a Skill name: confirm, then roll the Base Die plus the Skill
   * Bonus. A Required Skill with no Ranks cannot be rolled at all - the template does
   * not make those clickable, and this refuses them as well.
   */
  /**
   * Throw an Attacking Maneuver at a Feature rather than at a Character.
   *
   * The same door every other use goes through, with one thing turned off: the refusal
   * for having no target. Everything else is the Maneuver's own - the Actions, the Ki, the
   * Profile, the Ki Wager, the Energy Charges, the usage limit and the Instant rule - and
   * what changes is only what comes out the far end, because the entry settles the Strike
   * and the Wound before either would be rolled.
   */
  static async _onAttackFeature(event, target) {
    return useOwnedManeuver(this.actor, target.dataset.itemId, { atFeature: true });
  }

  /**
   * Say that this character hit something.
   *
   * The same window the Knockback's card opens, without the card. Nothing doubles or
   * halves it here: a Launching Profile and a Sudden Stop are things a Clash knows about,
   * and this door exists for the collisions no Clash saw.
   */
  static async _onTakeCollision() {
    const { takeCollisionDamage } = await import("../chat.mjs");
    return takeCollisionDamage(this.actor);
  }

  /**
   * The Survival Check made on entering an Unbreathable Environment.
   *
   * An ordinary Skill Check - the same roll, the same card, the same Karmic Chance - with
   * what it buys worked out from the total afterwards. Rolled here rather than from a chat
   * card because a Skill Check is the sheet's to make, and a second one built beside it
   * would be a second set of rows that could disagree with these.
   */
  static async _onHoldBreath() {
    const skill = this.actor.system.skills.survival;
    if (!skill || !isUnbreathable(this.actor)) return;

    // Marked before it is rolled. "Upon entering" is once, and a button still sitting
    // there after a bad roll is an invitation to make it twice.
    await this.actor.update({ "system.battlefield.breathRolled": true });

    const total = await this.#rollCheck({
      parts: [{ label: skill.label, value: skill.bonus }],
      flavor: `${skill.label} Check - holding your breath`,
      criticalDice: this.actor.system.dice.critical.formula,
      skillRoll: true
    });

    // A willing failure and a refusal both come back as nothing rolled. Neither is a
    // Dice Score, and neither buys any breath.
    const held = (typeof total === "number") ? difficultiesMet(total) : 0;
    await this.actor.update({ "system.battlefield.heldBreath": held });
    await settleBreath(this.actor);

    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: this.actor }),
      content: `<div class="dbu-settled-note">${Handlebars.escapeExpression(
        held
          ? `${this.actor.name} holds their breath - ${held} stack${held === 1 ? "" : "s"}`
            + " of Held Breath."
          : `${this.actor.name} could not take a breath in time.`)}</div>`
    });

    return held;
  }

  /**
   * Tick an Environmental Quality for the Square this character is standing in.
   *
   * Only the ones the player put there. An Environment's own come with the ground and are
   * drawn disabled - taking one off would be standing somewhere else.
   */
  static async _onToggleQuality(event, target) {
    const id = target.dataset.quality;
    const held = this.actor.system.battlefield.qualities ?? [];
    const next = held.includes(id)
      ? held.filter(quality => quality !== id)
      : [...held, id];

    return this.actor.update({ "system.battlefield.qualities": next });
  }

  static async _onSkillRoll(event, target) {
    const skill = this.actor.system.skills[target.dataset.skill];
    if (!skill) return;

    if (skill.untrained) {
      ui.notifications.warn(
        `${skill.label} is a Required Skill and cannot be rolled without at least one Rank.`
      );
      return;
    }

    const name = skill.specialization ? `${skill.label} (${skill.specialization})` : skill.label;
    const { BASE_DIE } = DBUCharacterData;
    // What is rolled, which is the Skill Bonus with everything that applies only to
    // rolling it. The two are separate because a bonus to Stealth Rolls is not a
    // higher Stealth Bonus - it does not raise the number on the sheet, and it is not
    // what another Skill is compared to.
    const total = skill.roll;
    const bonus = total >= 0 ? `+${total}` : String(total);

    // The confirmation and the roll window are the same dialog: asking twice for one
    // roll would be a click for nothing.
    // The specialisation is free text typed by the player, so it must be escaped.
    // "A Skill Check is how you use your Skills, both in combat and out... against an
    // Opponent in the form of a Clash or against a set Difficulty Category." The Clash is
    // opened by whatever rule calls for one; this is the other half, and it is the only
    // roll in the system that is offered a Target Number.
    const ready = await prepareRoll(
      this.actor, [], `${name} Check`,
      `Roll <strong>${Handlebars.escapeExpression(name)}</strong>? (${BASE_DIE} ${bonus})`,
      { difficulties: true }
    );
    if (!ready) return;

    // A Skill's critical die is a flat 1d4: it does not grow with Tier of Power.
    // Two rows, because they are two things: the Skill Bonus the sheet shows, and
    // whatever applies only to rolling this Skill - which does not raise that Bonus and
    // must not look as though it did.
    return this.#rollCheck({
      parts: [
        { label: name, value: skill.bonus },
        { label: "Effects", value: skill.roll - skill.bonus }
      ],
      flavor: `${name} Check`,
      criticalDice: DBUCharacterData.SKILL_CRITICAL_DIE,
      skillRoll: true,
      difficulty: ready.difficulty
    });
  }

  /**
   * Handle clicking the portrait to pick a new image. ApplicationV1's declarative
   * `data-edit="img"` handling does not exist in ApplicationV2, so the FilePicker
   * has to be opened explicitly from a registered action.
   */
  static async _onEditImage(event, target) {
    if (!this.isEditable) return;
    const attr = target.dataset.edit;
    const current = foundry.utils.getProperty(this.document, attr);
    const defaultArtwork = this.document.constructor.getDefaultArtwork?.(this.document.toObject()) ?? {};
    const picker = new foundry.applications.apps.FilePicker.implementation({
      current,
      type: "image",
      redirectToRoot: defaultArtwork.img ? [defaultArtwork.img] : [],
      callback: path => this.document.update({ [attr]: path }),
      top: this.position.top + 40,
      left: this.position.left + 10
    });
    return picker.browse();
  }

  /**
   * Handle clicking a tab nav link. We manage tab switching entirely ourselves
   * (instead of relying on Foundry's core tab-navigation template/behavior)
   * for reliable, predictable behavior across Foundry versions.
   */
  static _onChangeTab(event, target) {
    const tab = target.dataset.tab;
    const group = target.dataset.group;
    this.tabGroups[group] = tab;
    this.changeTab(tab, group, { event, navElement: target, force: true });
  }
}
