const { ActorSheetV2 } = foundry.applications.sheets;
const { HandlebarsApplicationMixin } = foundry.applications.api;

import DBUCharacterData from "../data/actor-character.mjs";
import { importCoreTalents, ownedTalents, reloadCoreTalents } from "../talents.mjs";
import { reactiveFor } from "../effects/registry.mjs";
import { traitsOfKind } from "../effects/traits.mjs";
import {
  conditionsFor,
  setCondition,
  setState,
  statesFor,
  toggleCondition,
  toggleState
} from "../conditions.mjs";
import { actionsLeft, isTheirTurn, newRoundFor, spendActions } from "../combat.mjs";
import { baseDieLine, extraDiceLine, partLine, noteLine, floorLine } from "../breakdown.mjs";
import { fireMoment } from "../effects/moments-runtime.mjs";
import {
  answeredLatestManeuver,
  checkCard,
  evaluateCheck,
  prepareRoll,
  whyNotWilling
} from "../chat.mjs";
import {
  MANEUVER_TYPES,
  PROFILES,
  maneuverKiCost,
  maneuverUsesLeft,
  usageLimitLabel
} from "../maneuvers.mjs";
import {
  coreManeuverItems,
  definitionOf,
  importCoreManeuvers,
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
      steadfastCheck: DBUCharacterSheet._onSteadfastCheck,
      importTalents: DBUCharacterSheet._onImportTalents,
      reloadTalents: DBUCharacterSheet._onReloadTalents,
      importManeuvers: DBUCharacterSheet._onImportManeuvers,
      grantManeuvers: DBUCharacterSheet._onGrantManeuvers,
      armTalent: DBUCharacterSheet._onArmTalent,
      editItem: DBUCharacterSheet._onEditItem,
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
    traits: { template: "systems/dbu-ttrpg/templates/parts/actor-traits.hbs", scrollable: [""] },
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
    traits: { id: "traits", group: "primary", label: "Traits" },
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
      value: this.actor.system.combat.wound[key]
    }));

    context.combatEditMode = this.#combatEditMode;
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
    context.conditions = conditionsFor(this.actor);
    const held = context.conditions.filter(c => c.active);
    context.anyCondition = held.length > 0;
    context.conditionSummary = held
      .map(c => (c.stacking ? `${c.name} ${c.stacks}` : c.name))
      .join(", ");
    context.conditionAbilities = this.#conditionAbilities();

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
    context.skillGroups = this._prepareSkillGroups();
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
    // An Instant Maneuver cannot follow another Instant. Two things can mean it just
    // did: playing one from here, which sets the flag, and answering the most recent
    // Standard Maneuver with one - which does not, because the Maneuver it answered
    // takes its place, but still leaves no room for another.
    const playedInstant = this.actor.system.lastManeuverWasInstant;
    const answered = answeredLatestManeuver(this.actor);

    const groups = [
      { key: "standard", playable: true },
      {
        key: "instant",
        playable: !playedInstant && !answered,
        note: playedInstant
          ? "Your last maneuver was an Instant"
          : (answered ? "You answered the last maneuver with an Instant" : "")
      },
      { key: "counter", playable: false, note: "Played from the attack they answer, in chat" }
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
          .map(maneuver => ({
            ...maneuver,
            // The cost as it will really be charged: `kiCost` on its own misses the
            // "2(bT)" notation and misses any discount an effect applies, so a
            // Maneuver priced that way showed as free.
            kiCost: maneuverKiCost(maneuver, null, this.actor),
            usageLabel: usageLimitLabel(maneuver),
            usesLeft: maneuverUsesLeft(this.actor, maneuver),
            // Off the group, unless the Maneuver has a reason of its own to be here.
            playable: group.playable || this.#playableAlone(maneuver),
            // Two different ways to be unable to play it, and the row says which:
            // out of uses is a limit of the Maneuver, out of Actions is a limit of
            // the round. Seen before clicking rather than after.
            exhausted: maneuverUsesLeft(this.actor, maneuver) <= 0,
            unaffordable: this.#shortOfActions(maneuver),
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
  _prepareSkillGroups() {
    const skills = Object.values(this.actor.system.skills);
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
      criticalDice: this.actor.system.dice.critical.formula
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
    const pending = this.actor.system.threshold.pending;
    if (!pending.length) return;

    const { STEADFAST_DIE, STEADFAST_TARGET, THRESHOLDS } = DBUCharacterData;
    const updates = {};

    // All but the last are passed through rather than stopped at.
    const automatic = pending.slice(0, -1);
    const rolled = pending[pending.length - 1];
    for (const key of automatic) updates[`system.thresholdChecks.${key}`] = "fail";

    const roll = new Roll(STEADFAST_DIE);
    await roll.evaluate();
    const passed = roll.total >= STEADFAST_TARGET;
    updates[`system.thresholdChecks.${rolled}`] = passed ? "pass" : "fail";

    await this.actor.update(updates);

    const carried = automatic.length
      ? ` (${automatic.map(key => THRESHOLDS[key].label).join(", ")} failed automatically)`
      : "";

    await roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor: this.actor }),
      flavor: `Steadfast Check - ${THRESHOLDS[rolled].label} - ${passed ? "passed" : "failed"}${carried}`
    });
  }

  /** Clear what only refreshes between Combat Encounters. */
  static async _onResetEncounter() {
    return this.actor.update({
      "system.usedManeuvers": [],
      "system.talentUses.encounter": [],
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
  async #rollCheck({ parts = [], flavor, criticalDice, skillRoll = false, urgent = false }) {
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
    const { roll, natural, botch, critical } = await evaluateCheck(this.actor, bonus);

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
      const held = floorLine(bonus - netted, "Penalties stop at the dice");
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
          lines: [...rows(), noteLine("Willing failure - the total is 0")],
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
        floorLine(botched - (roll.total - botchPenalty), "Nothing below zero")
      ].filter(Boolean);

      await ChatMessage.create({
        speaker,
        flavor: `${flavor} — Botch`,
        rolls: [roll],
        content: checkCard({ lines, total: botched, outcome: "botch", owner: this.actor.uuid }),
        flags: {
          "dbu-ttrpg": { check: { ...rerollable, total: botched, outcome: "botch", lines } }
        }
      });
      return;
    }

    // Posted as our own card rather than Foundry's, so a Skill Check is read the same
    // way as everything else. The Roll rides along on the message, which is what the
    // Critical Die button reaches for and what lets Foundry animate the dice.
    const lines = rows();
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
            ...rerollable, total: roll.total, outcome: critical ? "critical" : "", lines
          }
        }
      }
    });
  }

  /**
   * Handle clicking a Skill name: confirm, then roll the Base Die plus the Skill
   * Bonus. A Required Skill with no Ranks cannot be rolled at all - the template does
   * not make those clickable, and this refuses them as well.
   */
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
    const ready = await prepareRoll(
      this.actor, [], `${name} Check`,
      `Roll <strong>${Handlebars.escapeExpression(name)}</strong>? (${BASE_DIE} ${bonus})`
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
      skillRoll: true
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
