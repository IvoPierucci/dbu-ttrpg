const { ActorSheetV2 } = foundry.applications.sheets;
const { HandlebarsApplicationMixin } = foundry.applications.api;

import DBUCharacterData from "../data/actor-character.mjs";
import { checkCard } from "../chat.mjs";
import {
  exclusiveAttributeGroups,
  raceOptions,
  racialAttributeChoices,
  racialSkillRankCount
} from "../races.mjs";

/**
 * DBU TTRPG character sheet, built on the modern ApplicationV2 / ActorSheetV2
 * API (recommended approach as of Foundry v13+, required going forward in v14+).
 */
export default class DBUCharacterSheet extends HandlebarsApplicationMixin(ActorSheetV2) {

  static DEFAULT_OPTIONS = {
    classes: ["dbu-ttrpg", "character"],
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
      editImage: DBUCharacterSheet._onEditImage
    },
    form: {
      submitOnChange: true
    }
  };

  static PARTS = {
    header: { template: "systems/dbu-ttrpg/templates/parts/actor-header.hbs" },
    tabs: { template: "systems/dbu-ttrpg/templates/parts/actor-tabs.hbs" },
    main: { template: "systems/dbu-ttrpg/templates/parts/actor-main.hbs" },
    progression: { template: "systems/dbu-ttrpg/templates/parts/actor-progression.hbs" },
    biography: { template: "systems/dbu-ttrpg/templates/parts/actor-biography.hbs" }
  };

  tabGroups = { primary: "main" };

  static TABS = {
    main: { id: "main", group: "primary", label: "Main" },
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
    context.skillGroups = this._prepareSkillGroups();
    context.racialSkillRanks = this._prepareRacialSkillRanks();
    context.racialAttributeChoices = this._prepareRacialAttributeChoices();
    context.raceOptions = raceOptions().map(option => ({
      ...option,
      selected: option.value === this.actor.system.race
    }));
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
    const { SKILLS, TALENT_OPTIONS } = DBUCharacterData;

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
        talentOptions: TALENT_OPTIONS.map(option => ({ value: option, selected: option === entry.talent })),
        // The Level 1 Skill Improvement offers 6 rank slots; every other one offers 4.
        skillRanks: Array.from({ length: DBUCharacterData.skillRankSlotsFor(entry) }, (unused, slot) => {
          const value = entry.skillRanks[slot] ?? "";
          const rankCap = DBUCharacterData.skillRankCap(DBUCharacterData.tierOfPowerFor(entry.lvl));
          const prior = ranksBeforeRow[index];

          return {
            name: `system.progression.${index}.skillRanks.${slot}`,
            value,
            options: Object.entries(SKILLS).map(([key, skill]) => {
              // One Skill Improvement cannot raise the same Skill twice.
              const takenBySibling = entry.skillRanks.includes(key);
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
    return this.#rollCheck({ bonus: attribute.mod, flavor: `${label} Check` });
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

  /**
   * Roll the Base Die plus a bonus and post it to chat.
   *
   * Whether a check crits or botches depends on the Base Die's own result, so neither
   * can be part of the formula. The roll is therefore posted as-is: a Botch reports
   * its adjusted total in the flavor, and a critical is flagged for the chat hook,
   * which offers the extra die as a button on the message (see chat.mjs).
   */
  async #rollCheck({ bonus, flavor }) {
    const { BASE_DIE, BOTCH_PENALTY } = DBUCharacterData;

    const roll = new Roll(`${BASE_DIE} + @bonus`, { bonus });
    await roll.evaluate();

    const natural = roll.dice[0]?.total;
    const botch = natural === 1;
    // The Critical Target never drops below 7, so a Botch can never also be a crit.
    const critical = natural >= this.actor.system.criticalTarget;

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
      flags: { "dbu-ttrpg": { criticalPending: critical } }
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

    return this.#rollCheck({ bonus: skill.bonus, flavor: `${name} Check` });
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
