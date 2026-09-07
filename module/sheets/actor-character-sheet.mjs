const { ActorSheetV2 } = foundry.applications.sheets;
const { HandlebarsApplicationMixin } = foundry.applications.api;

import DBUCharacterData from "../data/actor-character.mjs";
import { importCoreTalents, ownedTalents, usesLeft } from "../talents.mjs";
import {
  checkCard,
  evaluateCheck,
  postAttack,
  postManeuver,
  postSkillClash,
  takeSurge
} from "../chat.mjs";
import {
  MANEUVER_TYPES,
  allManeuvers,
  declareAttack,
  maneuverUsesLeft,
  recordManeuverUse,
  usageLimitLabel,
  getManeuver,
  maneuverKiCost,
  spendManeuverCost
} from "../maneuvers.mjs";
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
    // Talents are Items, so the sheet has to accept one being dropped on it.
    dragDrop: [{ dragSelector: "[data-item-id]", dropSelector: null }],
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
      useManeuver: DBUCharacterSheet._onUseManeuver,
      resetCapacity: DBUCharacterSheet._onResetCapacity,
      resetEncounter: DBUCharacterSheet._onResetEncounter,
      steadfastCheck: DBUCharacterSheet._onSteadfastCheck,
      importTalents: DBUCharacterSheet._onImportTalents,
      armTalent: DBUCharacterSheet._onArmTalent,
      editItem: DBUCharacterSheet._onEditItem,
      deleteItem: DBUCharacterSheet._onDeleteItem,
      toggleCombatEdit: DBUCharacterSheet._onToggleCombatEdit,
      editImage: DBUCharacterSheet._onEditImage
    },
    form: {
      submitOnChange: true
    }
  };

  static PARTS = {
    header: { template: "systems/dbu-ttrpg/templates/parts/actor-header.hbs" },
    tabs: { template: "systems/dbu-ttrpg/templates/parts/sheet-tabs.hbs" },
    main: { template: "systems/dbu-ttrpg/templates/parts/actor-main.hbs" },
    combat: { template: "systems/dbu-ttrpg/templates/parts/actor-combat.hbs" },
    traits: { template: "systems/dbu-ttrpg/templates/parts/actor-traits.hbs" },
    progression: { template: "systems/dbu-ttrpg/templates/parts/actor-progression.hbs" },
    biography: { template: "systems/dbu-ttrpg/templates/parts/actor-biography.hbs" }
  };

  tabGroups = { primary: "main" };

  /**
   * Whether the Combat tab's tracking values are unlocked. Deliberately not stored on
   * the Actor: it is a guard against stray clicks during play, not a character trait,
   * and it should lapse when the sheet is closed.
   */
  #combatEditMode = false;

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

  /** Accept a Talent dropped onto the sheet, copying it onto this character. */
  async _onDrop(event) {
    if (!this.isEditable) return;

    const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
    if (data?.type !== "Item") return;

    const item = await Item.implementation.fromDropData(data);
    if (!item) return;

    if (item.type !== "talent") {
      ui.notifications.warn(`${item.name} is not a talent.`);
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
    context.threshold = this.actor.system.threshold;
    // Only what the character actually holds; a talent whose definition is missing is
    // dropped rather than shown as a blank row.
    context.talents = ownedTalents(this.actor).map(item => {
      // A talent is armable when it has an effect that is used rather than simply had.
      const triggered = item.system.effects.find(effect => effect.limits?.round || effect.limits?.encounter);
      return {
        item,
        triggered: triggered && {
          ...usesLeft(this.actor, { ...triggered, talentId: item.id }),
          armed: this.actor.system.armedTalents.includes(item.id)
        }
      };
    });
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
    // An Instant Maneuver cannot follow another Instant - nor an Out-of-Sequence one
    // played off the back of an Instant, which is why that never clears the flag.
    const blocked = this.actor.system.lastManeuverWasInstant;

    const groups = [
      { key: "standard", playable: true },
      {
        key: "instant",
        playable: !blocked,
        note: blocked ? "Your last maneuver was an Instant" : ""
      },
      { key: "counter", playable: false, note: "Played from the attack they answer, in chat" }
    ];

    return groups
      .map(group => ({
        ...group,
        label: MANEUVER_TYPES[group.key].label,
        maneuvers: allManeuvers()
          .filter(maneuver => maneuver.type === group.key)
          .map(maneuver => ({
            ...maneuver,
            usageLabel: usageLimitLabel(maneuver),
            usesLeft: maneuverUsesLeft(this.actor, maneuver),
            exhausted: maneuverUsesLeft(this.actor, maneuver) <= 0,
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
              // Nor can it push a Skill past the cap of this row's Tier of Power.
              const atCap = ((prior[key] ?? 0) + 1) > rankCap;

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
    // Not a Skill roll, so the critical uses the character's Critical Extra Dice.
    return this.#rollCheck({
      bonus: attribute.mod,
      flavor: `${label} Check`,
      criticalDice: this.actor.system.dice.critical.formula
    });
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

  /** GM only: put the published Talents in the Items directory to drag from. */
  static async _onImportTalents() {
    return importCoreTalents();
  }

  /**
   * Arm or disarm a triggered talent effect for the next Combat Roll.
   *
   * Armed ahead of the roll rather than offered during it: the client that resolves an
   * exchange is often not the one that owns the character rolling, so there is no
   * moment mid-roll at which the owner could be asked.
   */
  static async _onArmTalent(event, target) {
    const id = target.dataset.itemId;
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

  /** Unlock or re-lock the Combat tab's tracking values. */
  static _onToggleCombatEdit() {
    this.#combatEditMode = !this.#combatEditMode;
    this.render();
  }

  /**
   * Clear the Ki spent this Combat Round. Manual for now: the system has no notion of
   * a round to reset it against.
   */
  static async _onResetCapacity() {
    // Everything that only lasts a Combat Round clears together: Diminishing Defense
    // goes at the start of a round and Diminishing Offense at the end, which between
    // two rounds is the same moment.
    return this.actor.update({
      "system.capacity.spent": 0,
      "system.attacksThisRound": 0,
      "system.diminishingDefense": 0,
      "system.talentUses.round": []
    });
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
    const maneuver = getManeuver(target.dataset.maneuver);
    if (!maneuver) return;

    // The template does not offer these, but a stale render should not be a way past
    // the rules either.
    if ((maneuver.type === "instant") && this.actor.system.lastManeuverWasInstant) {
      ui.notifications.warn(
        `${this.actor.name} just played an Instant Maneuver and cannot play another.`
      );
      return;
    }

    if (maneuverUsesLeft(this.actor, maneuver) <= 0) {
      ui.notifications.warn(`${this.actor.name} has no uses of ${maneuver.name} left.`);
      return;
    }

    // A Surge is what the Maneuver does, and it can be declined once opened - so
    // nothing is spent or recorded until it has actually been taken.
    if (maneuver.surge) {
      // takeSurge posts the outcome itself, naming the Maneuver - announcing the
      // Maneuver separately would put the same event in chat twice.
      if (!await takeSurge(this.actor, { source: maneuver.name })) return;
      await recordManeuverUse(this.actor, maneuver);
      return DBUCharacterSheet.#trackInstant(this.actor, maneuver.type);
    }

    // Resolve the target before paying for anything, so a maneuver that cannot be
    // aimed does not cost Ki.
    let targetActor = null;
    if (maneuver.requiresTarget) {
      targetActor = game.user.targets.first()?.actor ?? null;
      if (!targetActor) {
        ui.notifications.warn(`${maneuver.name} needs a target. Target a token first.`);
        return;
      }
      if (targetActor.uuid === this.actor.uuid) {
        ui.notifications.warn(`${maneuver.name} cannot target its own user.`);
        return;
      }
    }

    // The Profile and its Foundation are declared before anything is paid, since
    // both choices can still be aborted - and the Profile is what sets the price.
    let declared = null;
    if (maneuver.profile) {
      declared = await declareAttack(maneuver, DBUCharacterData.FOUNDATIONS, this.actor);
      if (!declared) return;
    }

    if (!await spendManeuverCost(this.actor, maneuver, maneuverKiCost(maneuver, declared, this.actor))) return;

    await recordManeuverUse(this.actor, maneuver);
    await DBUCharacterSheet.#trackInstant(this.actor, maneuver.type);

    if (maneuver.clash) return postSkillClash(this.actor, targetActor, maneuver);
    if (declared) return postAttack(this.actor, targetActor, maneuver, declared);
    return postManeuver(this.actor, maneuver);
  }

  /**
   * Record whether this Maneuver leaves the character having just played an Instant.
   *
   * An Out-of-Sequence Maneuver deliberately leaves the flag alone: one played off
   * the back of an Instant does not count as a Maneuver in its place, so it cannot
   * launder an Instant into a legal follow-up.
   */
  static async #trackInstant(actor, type) {
    if (type === "outOfSequence") return;
    const wasInstant = type === "instant";
    if (actor.system.lastManeuverWasInstant === wasInstant) return;
    return actor.update({ "system.lastManeuverWasInstant": wasInstant });
  }

  /**
   * Roll the Base Die plus a bonus and post it to chat.
   *
   * Whether a check crits or botches depends on the Base Die's own result, so neither
   * can be part of the formula. The roll is therefore posted as-is: a Botch reports
   * its adjusted total in the flavor, and a critical is flagged for the chat hook,
   * which offers the extra die as a button on the message (see chat.mjs).
   */
  async #rollCheck({ bonus, flavor, criticalDice }) {
    const { BOTCH_PENALTY } = DBUCharacterData;
    const { roll, botch, critical } = await evaluateCheck(this.actor, bonus);

    const speaker = ChatMessage.getSpeaker({ actor: this.actor });

    if (botch) {
      // The penalty is certain, so the adjusted total is shown right away rather than
      // leaving the reader to subtract it from the card's number.
      const parts = `${roll.formula} = <strong>${roll.total}</strong>`
        + ` &nbsp;&minus;&nbsp; botch <strong>${BOTCH_PENALTY}</strong>`;
      await ChatMessage.create({
        speaker,
        flavor: `${flavor} — Botch`,
        rolls: [roll],
        content: checkCard({ parts, total: roll.total - BOTCH_PENALTY, outcome: "botch" })
      });
      return;
    }

    await roll.toMessage({
      speaker,
      flavor: critical ? `${flavor} — Critical` : flavor,
      // Picked up by the chat hook, which offers the extra die as a button.
      flags: { "dbu-ttrpg": { criticalPending: critical, criticalDice } }
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
    const bonus = skill.bonus >= 0 ? `+${skill.bonus}` : String(skill.bonus);

    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: `${name} Check` },
      // The specialisation is free text typed by the player, so it must be escaped.
      content: `<p>Roll <strong>${Handlebars.escapeExpression(name)}</strong>? (${BASE_DIE} ${bonus})</p>`,
      modal: true,
      rejectClose: false
    });
    if (!confirmed) return;

    // A Skill's critical die is a flat 1d4: it does not grow with Tier of Power.
    return this.#rollCheck({
      bonus: skill.bonus,
      flavor: `${name} Check`,
      criticalDice: DBUCharacterData.SKILL_CRITICAL_DIE
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
