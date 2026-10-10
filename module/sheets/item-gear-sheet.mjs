const { ItemSheetV2 } = foundry.applications.sheets;
const { HandlebarsApplicationMixin } = foundry.applications.api;

import { getTrait, printedLines, traitsOfKind } from "../effects/traits.mjs";
import { compile } from "../effects/parser.mjs";
import { CRAFTED, GEAR_TAGS, GEAR_TRIGGERS, GEAR_TYPES, WEAPON_SIZES, WEAPON_TYPES, categoryFitsPiece, composeEffects, connectable, craftedReading, effectsOf, namePrefixMatches, qualityChoiceLabel, qualityChoices, qualityEntries, qualityFitsPiece, qualityInactive, qualityName, qualitySlotRange, qualitySummary, pieceTokens, scriptWithPiece, slotsTaken, isNaturalArmor } from "../gear.mjs";
import DBUCharacterData from "../data/actor-character.mjs";

/**
 * Sheet for a piece of Gear.
 *
 * One page: the name and picture, what kind of Item it is, the rulebook's entry, and the
 * player's own description. The name and the description are theirs to change - a
 * character's Capsule Car is theirs to call what they like - and the entry stays as printed.
 *
 * A built Item - a piece of Apparel - has more to it than a page holds, so it is four tabs
 * under the same header: its Description, what it is (Category, Grade, Size), its Qualities,
 * and its Effects - the pseudo-code its Category and Qualities write into, which is what the
 * piece does.
 */
export default class DBUGearSheet extends HandlebarsApplicationMixin(ItemSheetV2) {

  static DEFAULT_OPTIONS = {
    classes: ["dbu-ttrpg", "gear"],
    position: { width: 480, height: 460 },
    window: { resizable: true },
    actions: {
      dbuChangeTab: DBUGearSheet._onChangeTab,
      editImage: DBUGearSheet._onEditImage,
      resyncEffects: DBUGearSheet._onResyncEffects,
      addQuality: DBUGearSheet._onAddQuality,
      removeQuality: DBUGearSheet._onRemoveQuality,
      toggleQuality: DBUGearSheet._onToggleQuality
    },
    form: { submitOnChange: true }
  };

  static PARTS = {
    header: { template: "systems/dbu-ttrpg/templates/parts/gear-header.hbs" },
    tabs: { template: "systems/dbu-ttrpg/templates/parts/sheet-tabs.hbs" },
    description: { template: "systems/dbu-ttrpg/templates/parts/gear-description.hbs",
      scrollable: [""] },
    crafted: { template: "systems/dbu-ttrpg/templates/parts/gear-crafted.hbs", scrollable: [""] },
    qualities: { template: "systems/dbu-ttrpg/templates/parts/gear-qualities.hbs",
      scrollable: [""] },
    effects: { template: "systems/dbu-ttrpg/templates/parts/gear-effects.hbs", scrollable: [""] },
    body: { template: "systems/dbu-ttrpg/templates/parts/gear-sheet.hbs", scrollable: [""] }
  };

  /** The built Item's tabs. Opened on what it is, which is what gets changed most. */
  static TABS = {
    description: { id: "description", group: "primary", label: "Description" },
    crafted: { id: "crafted", group: "primary", label: "" },
    qualities: { id: "qualities", group: "primary", label: "Qualities" },
    effects: { id: "effects", group: "primary", label: "Effects" }
  };

  tabGroups = { primary: "crafted" };

  /** Whether this Item is built rather than picked, which is what decides its tabs. */
  get #built() {
    return Boolean(CRAFTED[this.item.system.crafted?.kind]);
  }

  /** A built Item gets its tabs; any other keeps its one page. */
  _configureRenderParts(options) {
    const parts = super._configureRenderParts(options);
    const keep = this.#built
      ? ["header", "tabs", "description", "crafted", "qualities", "effects"]
      : ["header", "body"];
    for (const key of Object.keys(parts)) if (!keep.includes(key)) delete parts[key];
    return parts;
  }

  static _onChangeTab(event, target) {
    const { tab, group } = target.dataset;
    this.tabGroups[group] = tab;
    this.changeTab(tab, group, { event, navElement: target, force: true });
  }

  /** @override */
  async _onRender(context, options) {
    await super._onRender(context, options);
    this.#wireQualitySearch();
    // A Quality renamed on its row - Dynamic: the name, and its part's in the Effects. Not a
    // field of the form, so the form has nothing to save from it.
    for (const input of this.element.querySelectorAll("[data-quality-rename]")) {
      input.addEventListener("change", event => {
        event.stopPropagation();
        this.#renameQuality(Number(input.dataset.index), input.value);
      });
    }
    // A piece made before Items had Effects of their own: what its Category and Qualities
    // would write, written down now, so it is there to read and to change.
    const crafted = this.item.system.crafted;
    if (this.#built && (typeof crafted?.effects !== "string") && this.isEditable) {
      await this.item.update({ "system.crafted.effects": effectsOf(crafted, getTrait) });
    }
  }

  /**
   * An update that changes the Qualities, with the Effects they write: a new one's part
   * written in, a removed one's taken out, a switched one's lines commented or given back.
   * Everything else in the Effects stays as it was written.
   */
  #withQualities(qualities) {
    const crafted = this.item.system.crafted;
    return {
      "system.crafted.qualities": qualities,
      "system.crafted.effects": composeEffects({ ...crafted, qualities },
        effectsOf(crafted, getTrait), { getTrait })
    };
  }

  /**
   * Re-sync: every word of the Effects replaced by what its Category and Qualities write -
   * whatever was changed or added, in a part or outside every part, is lost, which is asked
   * first.
   */
  static async _onResyncEffects(event, target) {
    const crafted = this.item.system.crafted;
    const sure = await foundry.applications.api.DialogV2.confirm({
      classes: ["dbu-dialog"],
      window: { title: "Re-sync Effects" },
      content: "<p>All of this piece's Effects are replaced by what its Category and Qualities "
        + "write. Anything you changed or added is lost.</p>",
      rejectClose: false
    });
    if (!sure) return;
    return this.item.update({ "system.crafted.effects": composeEffects(crafted, "", { getTrait }) });
  }

  /** Name a Quality that takes one - Dynamic - by where it is in the list. */
  async #renameQuality(index, name) {
    const qualities = qualityEntries(this.item.system.crafted)
      .map((entry, at) => (at === index) ? { ...entry, name: String(name ?? "").trim() } : entry);
    return this.item.update(this.#withQualities(qualities));
  }

  /**
   * The Add Quality search: typed into, and the list under it keeps only the Qualities whose
   * name starts with what has been typed so far. Arrows move, Enter picks, and Enter again
   * adds; a click picks.
   */
  #wireQualitySearch() {
    const input = this.element.querySelector("[data-quality-search]");
    const list = this.element.querySelector("[data-quality-list]");
    if (!input || !list) return;
    const options = [...list.querySelectorAll("[data-quality-option]")];
    const groups = [...list.querySelectorAll("[data-quality-group]")];
    const none = list.querySelector("[data-quality-none]");
    const shown = () => options.filter(option => !option.hidden);
    const lit = () => options.find(option => option.classList.contains("active"));
    const light = option => {
      for (const each of options) each.classList.toggle("active", each === option);
      if (!option) return;
      // Within the list only: scrollIntoView would scroll the tab under it too, and the
      // search off the top.
      const top = option.offsetTop;
      const bottom = top + option.offsetHeight;
      if (top < list.scrollTop) list.scrollTop = top;
      else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
    };
    const filter = () => {
      for (const option of options) {
        option.hidden = !namePrefixMatches(option.dataset.name, input.value);
      }
      for (const group of groups) {
        group.hidden = !options.some(option => !option.hidden
          && (option.dataset.group === group.dataset.qualityGroup));
      }
      if (none) none.hidden = shown().length > 0;
      light(shown()[0]);
    };
    const open = () => {
      list.hidden = false;
      filter();
    };
    const pick = option => {
      input.value = option.dataset.name;
      input.dataset.picked = option.dataset.qualityOption;
      list.hidden = true;
    };

    input.addEventListener("focus", open);
    input.addEventListener("click", () => list.hidden && open());
    input.addEventListener("input", () => {
      delete input.dataset.picked;
      open();
    });
    // Not a field of the Item: typing in it is no change to save.
    input.addEventListener("change", event => event.stopPropagation());
    input.addEventListener("blur", () => { list.hidden = true; });
    input.addEventListener("keydown", event => {
      const visible = shown();
      const at = visible.indexOf(lit());
      if ((event.key === "ArrowDown") || (event.key === "ArrowUp")) {
        event.preventDefault();
        if (list.hidden) return open();
        const step = (event.key === "ArrowDown") ? 1 : -1;
        light(visible[Math.min(Math.max(at + step, 0), visible.length - 1)]);
      } else if (event.key === "Enter") {
        // Never the form's own Enter.
        event.preventDefault();
        if (!list.hidden && lit()) pick(lit());
        else if (input.dataset.picked) DBUGearSheet._onAddQuality.call(this, event, input);
      } else if ((event.key === "Escape") && !list.hidden) {
        // Closes the list, not the sheet.
        event.preventDefault();
        event.stopPropagation();
        list.hidden = true;
      }
    });
    // Picked before the field loses focus, so the list is still there to be clicked.
    list.addEventListener("mousedown", event => {
      event.preventDefault();
      const option = event.target.closest("[data-quality-option]");
      if (option) pick(option);
    });
  }

  /**
   * Which Quality the search means: the one picked, or the first whose name starts with
   * what was typed - the one the list shows first.
   */
  #pickedQuality() {
    const input = this.element.querySelector("[data-quality-search]");
    if (!input) return "";
    if (input.dataset.picked) return input.dataset.picked;
    if (!input.value.trim()) return "";
    return [...this.element.querySelectorAll("[data-quality-option]")]
      .find(option => namePrefixMatches(option.dataset.name, input.value))
      ?.dataset.qualityOption ?? "";
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const system = this.item.system;

    context.item = this.item;
    context.system = system;
    context.fields = system.schema.fields;
    context.enrichedDescription = await foundry.applications.ux.TextEditor.implementation.enrichHTML(
      system.description, { relativeTo: this.item });

    context.typeLabel = `${system.special ? "Special " : ""}${GEAR_TYPES[system.itemType]?.label ?? ""}`;
    context.sizeLabel = system.size ?? "";
    // A Weapon, an Accessory or a piece of Apparel may be Integrated - the table's box, or an effect's (the user's).
    context.integratable = ["weapon", "apparel"].includes(system.crafted?.kind) || (system.itemType === "accessory");
    // A piece of Apparel may be Natural Armor - Integrated with it, and its entry under its Category's (the user's).
    context.naturalArmorable = system.crafted?.kind === "apparel";
    context.naturalArmor = isNaturalArmor(this.item);
    context.tagLabels = (system.tags ?? []).map(tag => GEAR_TAGS[tag]?.label ?? tag);

    // What it recorded from its maker, and what sets it off - both theirs to change.
    context.recordsLabel = system.records
      ? `Recorded ${system.records.charAt(0).toUpperCase()}${system.records.slice(1)} Modifier`
      : "";
    context.triggerChoices = (system.triggers ?? []).map(trigger => ({
      value: trigger,
      label: GEAR_TRIGGERS[trigger]?.label ?? trigger,
      chosen: trigger === system.trigger
    }));
    // What it was made with and has left - editable, since the table may give or take.
    context.chargesLabel = (system.chargesDice || system.storesDrain
      || system.chargesPerBaseTier)
      ? (system.chargesLabel || "Charges") : "";
    // What it can be connected to among its owner's Items, and which it is.
    context.connectChoices = (system.connects ?? []).length
      ? connectable(this.item.actor?.items?.filter(owned => owned.type === "gear") ?? [],
        this.item).map(item => ({
        value: item.id, label: item.name, chosen: item.id === system.connectedTo
      }))
      : [];
    context.connects = (system.connects ?? []).length > 0;
    // Who it is tied to, among the world's characters - never whoever holds it.
    context.assigns = Boolean(system.assignsCharacter);
    context.assignChoices = context.assigns
      ? game.actors.filter(actor => (actor.type === "character")
        && (actor.uuid !== this.item.actor?.uuid))
        .map(actor => ({ value: actor.uuid, label: actor.name,
          chosen: actor.uuid === system.assigned?.uuid }))
      : [];
    // Made at a higher Craft DC for a longer reach - chosen here, how it was made being the
    // player's and the ARC's.
    context.upgrade = system.upgrade?.craftDC
      ? { label: `Craft DC ${system.upgrade.craftDC}: +${system.upgrade.reach} Melee Range` }
      : null;
    context.craftDCNow = (system.upgrade?.chosen && system.upgrade.craftDC)
      ? system.upgrade.craftDC
      : system.craftDC;
    // Who it was made for, among the world's characters - whoever holds it included.
    context.declaresIntended = Boolean(system.declaresIntended);
    context.intendedChoices = context.declaresIntended
      ? game.actors.filter(actor => actor.type === "character")
        .map(actor => ({ value: actor.uuid, label: actor.name,
          chosen: actor.uuid === system.intended?.uuid }))
      : [];
    context.hasControls = Boolean(context.recordsLabel || context.triggerChoices.length
      || context.chargesLabel || context.connects || context.upgrade || context.assigns
      || context.declaresIntended);

    // Built rather than picked: its Category, Grade and Size to change, what those come
    // to, and its Qualities to add and take off.
    context.crafted = this.#craftedContext(system);
    if (context.crafted) context.craftDCNow = context.crafted.reading.craftDCLabel;
    // The middle tab is named for what was built - "Apparel", and "Weapon" when there are.
    context.tabs = Object.fromEntries(Object.entries(this.constructor.TABS).map(([key, tab]) =>
      [key, { ...tab, label: tab.label || (context.crafted?.label ?? ""),
        cssClass: this.tabGroups[tab.group] === key ? "active" : "" }]));

    // The file's entry where the file still has one, and the copy's otherwise - the rules
    // live in traits/, and a copy made last week holds last week's wording. A built Item's
    // entry is its Category's.
    const entry = getTrait(system.gearId)?.text
      || (context.crafted ? getTrait(system.crafted.category)?.text : "")
      || system.text;
    context.entry = printedLines(entry).map(line => ({ text: line, gap: !line }));
    if (context.naturalArmor) {
      const { NATURAL_ARMOR_TEXT } = await import("../natural-armor.mjs");
      context.entry.push(...(context.entry.length ? [{ text: "", gap: true }] : []),
        ...printedLines(NATURAL_ARMOR_TEXT).map(line => ({ text: line, gap: !line })));
    }

    return context;
  }

  /** What a built Item's section needs: the choices, what they come to, its Qualities. */
  #craftedContext(system) {
    const crafted = system.crafted;
    const kind = CRAFTED[crafted?.kind];
    if (!kind) return null;

    const baseTier = this.item.actor?.system?.baseTierOfPower ?? null;
    const reading = craftedReading(crafted, { getTrait,
      difficulties: DBUCharacterData.DIFFICULTIES, baseTier: baseTier ?? 1,
      data: this.item.actor?.system ?? null });
    const weapon = crafted.kind === "weapon";
    const escape = Handlebars.escapeExpression;
    const difficulty = key => DBUCharacterData.DIFFICULTIES[key]?.label ?? key;

    return {
      label: kind.label,
      reading,
      // A Weapon: its Type and Size to choose, and what it is - its Life Points and the rest.
      weapon,
      typeChoices: Object.entries(WEAPON_TYPES).map(([key, type]) => ({
        value: key, label: type.label, chosen: key === crafted.weaponType
      })),
      weaponSizeChoices: Object.entries(WEAPON_SIZES).map(([key, size]) => ({
        value: key, label: size.label, chosen: key === crafted.weaponSize,
        tip: size.strike ? `Strike ${size.strike > 0 ? "+" : ""}${size.strike}(T), Wound `
          + `${size.wound > 0 ? "+" : ""}${size.wound}(T) on attacks made with it.` : ""
      })),
      // Stretching: its Size is its wearer's, whatever it was made at - as its Effects say.
      stretches: reading.sizeIsWearers,
      // Its own pseudo-code, and whether it compiles - against its owner, where it has one, so
      // a Skill it names is one they have.
      effectsText: effectsOf(crafted, getTrait),
      // `$apparelBonus` read as this piece's own, as it is when the piece is worn.
      effectErrors: compile(scriptWithPiece(effectsOf(crafted, getTrait), reading,
        pieceTokens(this.item, this.item.actor, reading, getTrait)),
        this.item.actor?.system ?? null).errors ?? [],
      // The Bonus as the rule writes it, and what it comes to for whoever holds it.
      bonusLabel: `${reading.perBaseTier}(bT)${(baseTier !== null) ? ` = ${reading.bonus}` : ""}`,
      // A Weapon's by its Type: "The Weapon Categories available are decided based on the
      // Weapon Type chosen."
      categoryChoices: traitsOfKind("crafting", kind.categories)
        .filter(trait => categoryFitsPiece(trait, crafted)).map(trait => ({
          value: trait.id, label: trait.name, chosen: trait.id === crafted.category
        })),
      gradeChoices: Object.entries(kind.grades).map(([grade, row]) => ({
        value: Number(grade),
        label: [`${grade} - ${difficulty(row.craftDC)}`, kind.bonus?.[row.grade]?.label,
          `${row.slots} Slot${row.slots === 1 ? "" : "s"}`].filter(Boolean).join(", "),
        chosen: Number(grade) === Number(crafted.grade)
      })),
      sizeChoices: Object.entries(DBUCharacterData.SIZES).map(([key, size]) => ({
        value: key, label: size.label, chosen: key === crafted.size
      })),
      qualities: qualityEntries(crafted).map((entry, index) => {
        const trait = getTrait(entry.id);
        const taken = slotsTaken(entry, trait);
        return {
          index,
          name: qualityName(entry, trait),
          // One its owner names - Dynamic: its row is where.
          renameable: trait?.renameable === true,
          tip: escape(trait?.description ?? ""),
          slotsLabel: `${taken} Slot${taken === 1 ? "" : "s"}`,
          // What was chosen for it, by name.
          choiceLabel: qualityChoiceLabel(trait, entry.choice, DBUCharacterData.SKILLS,
            DBUGearSheet.#weathers(), getTrait),
          // A switch of its own, where its effect waits on something the table keeps.
          toggle: trait?.toggle ? String(trait.toggle) : "",
          on: entry.on,
          // Its Category does not take it, or another Quality holds it off: kept, and
          // inactive until that changes.
          misfit: DBUGearSheet.#inactiveNote(qualityInactive(entry, crafted, getTrait),
            weapon ? reading.weaponTypeLabel : reading.categoryName, kind.label)
        };
      }),
      // What its Qualities do, a block to each, a tagged line to each effect with its
      // Prerequisites first: the Effects between the search and the list. One held off, or switched off, is shown faded and says so.
      effects: qualityEntries(crafted).map(entry => {
        const trait = getTrait(entry.id);
        const inactive = qualityInactive(entry, crafted, getTrait);
        const switchedOff = Boolean(trait?.toggle) && !entry.on;
        return {
          name: qualityName(entry, trait),
          choiceLabel: qualityChoiceLabel(trait, entry.choice, DBUCharacterData.SKILLS,
            DBUGearSheet.#weathers(), getTrait),
          off: Boolean(inactive) || switchedOff,
          offNote: inactive ? "Inactive" : (switchedOff ? "Switched off" : ""),
          lines: qualitySummary(trait)
        };
      }).filter(block => block.lines.length),
      // Only the ones this Category takes are offered.
      qualityChoices: traitsOfKind("crafting", kind.qualities)
        .filter(trait => qualityFitsPiece(trait, crafted))
        .map(trait => {
          const { min, max, ranged } = qualitySlotRange(trait);
          return { value: trait.id, label: `${trait.name} (${ranged ? `${min}-${max}` : min})`,
            special: trait.special === true };
        }),
      // "Special Apparel Qualities ... cannot typically be gained through Crafting Apparel" -
      // offered apart, as the Special Basic Items are.
      qualityGroups: DBUGearSheet.#qualityGroups(kind, crafted),
      // More than one Special on a piece: said, since the rule only asks the ARC to be wary.
      specialNote: (reading.specials > 1)
        ? `${reading.specials} Special ${kind.label} Qualities on one piece. The ARC should be `
          + "wary of more than one."
        : "",
      // Over is said, not refused: it works as it is. "Insufficient Quality Slots" on the tab,
      // and this under the pointer.
      overNote: reading.over
        ? `${reading.used} Quality Slots used, and Craftsmanship Grade ${crafted.grade} gives `
          + `${reading.slots}. It still works.`
        : ""
    };
  }

  /**
   * Add the Quality picked beside the button. Any number: over the Slots is only said.
   *
   * One that takes a range asks how many: "If there is a range, then you may select how many
   * Quality Slots a Apparel Quality takes up."
   */
  static async _onAddQuality(event, target) {
    const pick = this.#pickedQuality();
    if (!pick) return this.element.querySelector("[data-quality-search]")?.focus();
    const trait = getTrait(pick);
    const { min, max, ranged } = qualitySlotRange(trait);
    let slots = min;
    if (ranged) {
      const chosen = await foundry.applications.api.DialogV2.wait({
        classes: ["dbu-dialog"],
        window: { title: `${trait?.name ?? pick} - Quality Slots` },
        content: "",
        buttons: [
          ...Array.from({ length: max - min + 1 }, (_, at) => ({
            action: String(min + at), label: String(min + at) })),
          { action: "cancel", label: "Cancel" }
        ],
        rejectClose: false
      });
      slots = Number(chosen);
      if (!Number.isFinite(slots) || (slots < min) || (slots > max)) return;
    }
    // "A Skill of your choice (when creating this piece of Apparel)", Focal's Strike or Dodge:
    // asked now, and kept with the Quality.
    let choice = "";
    const crafted = this.item.system.crafted;
    const offered = qualityChoices(trait, DBUCharacterData.SKILLS, DBUGearSheet.#weathers(),
      { crafted, categories: traitsOfKind("crafting", CRAFTED[crafted.kind]?.categories ?? "") });
    if (offered.length) {
      // One for each Slot, where it chooses that many - "For each Quality Slot this Weapon Quality
      // takes up, select a different Weapon Category" - each different from the last.
      const times = (trait?.choosesPerSlot === true) ? slots : 1;
      const picked = [];
      for (let at = 0; at < times; at++) {
        const left = offered.filter(key => !picked.includes(key));
        if (!left.length) break;
        const one = await foundry.applications.api.DialogV2.wait({
          classes: ["dbu-dialog"],
          window: { title: (times > 1) ? `${trait?.name ?? pick} (${at + 1}/${times})` : (trait?.name ?? pick) },
          content: "",
          buttons: [
            ...left.map(key => ({ action: key,
              label: qualityChoiceLabel(trait, key, DBUCharacterData.SKILLS,
                DBUGearSheet.#weathers(), getTrait) })),
            { action: "cancel", label: "Cancel" }
          ],
          rejectClose: false
        });
        if (!left.includes(one)) return;
        picked.push(one);
      }
      choice = picked.join(",");
    }
    const qualities = [...qualityEntries(this.item.system.crafted), { id: pick, slots, choice }];
    return this.item.update(this.#withQualities(qualities));
  }

  /** The Qualities its Category takes, ordinary and Special apart, as the picker's groups. */
  static #qualityGroups(kind, crafted) {
    const offered = traitsOfKind("crafting", kind.qualities)
      .filter(trait => qualityFitsPiece(trait, crafted))
      .map(trait => {
        const { min, max, ranged } = qualitySlotRange(trait);
        return { value: trait.id, name: trait.name,
          label: `${trait.name} (${ranged ? `${min}-${max}` : min})`,
          special: trait.special === true };
      });
    const label = CRAFTED[crafted.kind]?.label ?? "";
    return [
      { label: `${label} Quality`, choices: offered.filter(choice => !choice.special) },
      { label: `Special ${label} Quality`, choices: offered.filter(choice => choice.special) }
    ].filter(group => group.choices.length);
  }

  /** The Battle Weathers there are, for a Quality that chooses one - Weather Resistant. */
  static #weathers() {
    return Object.fromEntries(traitsOfKind("battlefields").filter(trait => trait.weather === true)
      .map(trait => [trait.id, { label: trait.name }]));
  }

  /** Why a Quality on it is inactive, as its row says it. */
  static #inactiveNote(why, categoryName, kindLabel = "Apparel") {
    if (!why) return "";
    if ((why === "category") || (why === "type")) return `Not for ${categoryName}: inactive.`;
    return `This ${kindLabel} ${why}: inactive.`;
  }

  /** Switch a Quality's toggle - Team Outfit's - by where it is in the list. */
  static async _onToggleQuality(event, target) {
    const index = Number(target.dataset.index);
    const qualities = qualityEntries(this.item.system.crafted)
      .map((entry, at) => (at === index) ? { ...entry, on: !entry.on } : entry);
    return this.item.update(this.#withQualities(qualities));
  }

  /** Take one Quality off, by where it is in the list. */
  static async _onRemoveQuality(event, target) {
    const index = Number(target.dataset.index);
    const qualities = qualityEntries(this.item.system.crafted).filter((entry, at) => at !== index);
    return this.item.update(this.#withQualities(qualities));
  }

  /**
   * Keep the assigned Character's name with their uuid, so the row can say who it is even
   * where the Actor cannot be read.
   */
  async _processSubmitData(event, form, submitData, options) {
    // Natural Armor - "a special form of Integrated Armor" - is Armor, whatever its select says (the user's).
    const natural = foundry.utils.getProperty(submitData, "flags.dbu-ttrpg.naturalArmor") ?? isNaturalArmor(this.item);
    if (natural === true) foundry.utils.setProperty(submitData, "system.crafted.category", "armor");
    // Made Natural Armor: Integrated with it, unasked - and on a character, its Grade theirs.
    if ((foundry.utils.getProperty(submitData, "flags.dbu-ttrpg.naturalArmor") === true) && !isNaturalArmor(this.item)) {
      foundry.utils.setProperty(submitData, "system.integrated", true);
      if (this.item.actor) {
        const { naturalArmorGrade } = await import("../natural-armor.mjs");
        foundry.utils.setProperty(submitData, "system.crafted.grade", naturalArmorGrade(this.item.actor));
      }
    }
    // Connected to something else on the Item: the pair goes with it, for a Collar.
    const connected = foundry.utils.getProperty(submitData, "system.connectedTo");
    if (connected !== undefined) {
      foundry.utils.setProperty(submitData, "system.connectedPair",
        this.item.actor?.items?.get(connected)?.system?.pairId ?? "");
    }
    for (const field of ["assigned", "intended"]) {
      const uuid = foundry.utils.getProperty(submitData, `system.${field}.uuid`);
      if (uuid !== undefined) {
        foundry.utils.setProperty(submitData, `system.${field}.name`,
          uuid ? (fromUuidSync(uuid)?.name ?? "") : "");
      }
    }
    // A new Category writes its part into the Effects in place of the old one's, and takes
    // out the parts of the Qualities it does not take - into what the Effects say as sent,
    // which is what is on the page.
    const crafted = this.item.system.crafted;
    let category = foundry.utils.getProperty(submitData, "system.crafted.category");
    // A Weapon given another Type: its Category goes with it, to the first of the new Type's
    // where the one it had is not one of them.
    const weaponType = foundry.utils.getProperty(submitData, "system.crafted.weaponType");
    const retyped = this.#built && (weaponType !== undefined) && (weaponType !== crafted.weaponType);
    if (retyped) {
      const now = { ...crafted, weaponType };
      if (!categoryFitsPiece(getTrait(category ?? crafted.category), now)) {
        category = traitsOfKind("crafting", CRAFTED[crafted.kind].categories)
          .find(trait => categoryFitsPiece(trait, now))?.id ?? "";
        foundry.utils.setProperty(submitData, "system.crafted.category", category);
      }
    }
    if (this.#built && (retyped || ((category !== undefined) && (category !== crafted.category)))) {
      const sent = foundry.utils.getProperty(submitData, "system.crafted.effects");
      foundry.utils.setProperty(submitData, "system.crafted.effects",
        composeEffects({ ...crafted, category: category ?? crafted.category,
          weaponType: weaponType ?? crafted.weaponType },
        sent ?? effectsOf(crafted, getTrait), { getTrait }));
    }
    return super._processSubmitData(event, form, submitData, options);
  }

  /** Handle clicking the picture to pick a new one. */
  static async _onEditImage(event, target) {
    if (!this.isEditable) return;
    const attr = target.dataset.edit;
    const picker = new foundry.applications.apps.FilePicker.implementation({
      current: foundry.utils.getProperty(this.document, attr),
      type: "image",
      callback: path => this.document.update({ [attr]: path }),
      top: this.position.top + 40,
      left: this.position.left + 10
    });
    return picker.browse();
  }
}
