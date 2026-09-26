const { ItemSheetV2 } = foundry.applications.sheets;
const { HandlebarsApplicationMixin } = foundry.applications.api;

import { getTrait, printedLines, traitsOfKind } from "../effects/traits.mjs";
import { CRAFTED, GEAR_TAGS, GEAR_TRIGGERS, GEAR_TYPES, connectable, craftedReading,
  qualityChoiceLabel, qualityChoices, qualityEntries, qualityFits, qualityInactive,
  qualitySlotRange, slotsTaken } from "../gear.mjs";
import DBUCharacterData from "../data/actor-character.mjs";

/**
 * Sheet for a piece of Gear.
 *
 * One page: the name and picture, what kind of Item it is, the rulebook's entry, and the
 * player's own description. The name and the description are theirs to change - a
 * character's Capsule Car is theirs to call what they like - and the entry stays as printed.
 */
export default class DBUGearSheet extends HandlebarsApplicationMixin(ItemSheetV2) {

  static DEFAULT_OPTIONS = {
    classes: ["dbu-ttrpg", "gear"],
    position: { width: 480, height: 460 },
    window: { resizable: true },
    actions: {
      editImage: DBUGearSheet._onEditImage,
      addQuality: DBUGearSheet._onAddQuality,
      removeQuality: DBUGearSheet._onRemoveQuality,
      toggleQuality: DBUGearSheet._onToggleQuality
    },
    form: { submitOnChange: true }
  };

  static PARTS = {
    body: { template: "systems/dbu-ttrpg/templates/parts/gear-sheet.hbs", scrollable: [""] }
  };

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

    // The file's entry where the file still has one, and the copy's otherwise - the rules
    // live in traits/, and a copy made last week holds last week's wording. A built Item's
    // entry is its Category's.
    const entry = getTrait(system.gearId)?.text
      || (context.crafted ? getTrait(system.crafted.category)?.text : "")
      || system.text;
    context.entry = printedLines(entry).map(line => ({ text: line, gap: !line }));

    return context;
  }

  /** What a built Item's section needs: the choices, what they come to, its Qualities. */
  #craftedContext(system) {
    const crafted = system.crafted;
    const kind = CRAFTED[crafted?.kind];
    if (!kind) return null;

    const baseTier = this.item.actor?.system?.baseTierOfPower ?? null;
    const reading = craftedReading(crafted, { getTrait,
      difficulties: DBUCharacterData.DIFFICULTIES, baseTier: baseTier ?? 1 });
    const escape = Handlebars.escapeExpression;
    const difficulty = key => DBUCharacterData.DIFFICULTIES[key]?.label ?? key;

    return {
      label: kind.label,
      reading,
      // Stretching: its Size is its wearer's, whatever it was made at.
      stretches: qualityEntries(crafted).some(entry => !qualityInactive(entry, crafted, getTrait)
        && (getTrait(entry.id)?.sizeIsWearers === true)),
      // The Bonus as the rule writes it, and what it comes to for whoever holds it.
      bonusLabel: `${reading.perBaseTier}(bT)${(baseTier !== null) ? ` = ${reading.bonus}` : ""}`,
      categoryChoices: traitsOfKind("crafting", kind.categories).map(trait => ({
        value: trait.id, label: trait.name, chosen: trait.id === crafted.category
      })),
      gradeChoices: Object.entries(kind.grades).map(([grade, row]) => ({
        value: Number(grade),
        label: `${grade} - ${difficulty(row.craftDC)}, ${kind.bonus[row.grade].label}, `
          + `${row.slots} Slot${row.slots === 1 ? "" : "s"}`,
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
          name: trait?.name ?? entry.id,
          tip: escape(trait?.description ?? ""),
          slotsLabel: `${taken} Slot${taken === 1 ? "" : "s"}`,
          // What was chosen for it, by name.
          choiceLabel: qualityChoiceLabel(trait, entry.choice, DBUCharacterData.SKILLS,
            DBUGearSheet.#weathers()),
          // A switch of its own, where its effect waits on something the table keeps.
          toggle: trait?.toggle ? String(trait.toggle) : "",
          on: entry.on,
          // Its Category does not take it, or another Quality holds it off: kept, and
          // inactive until that changes.
          misfit: DBUGearSheet.#inactiveNote(qualityInactive(entry, crafted, getTrait),
            reading.categoryName)
        };
      }),
      // Only the ones this Category takes are offered.
      qualityChoices: traitsOfKind("crafting", kind.qualities)
        .filter(trait => qualityFits(trait, crafted.category))
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
        ? `${reading.specials} Special Apparel Qualities on one piece. The ARC should be wary `
          + "of more than one."
        : "",
      // Over is said, not refused: it works as it is.
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
    const pick = this.element.querySelector("select[data-quality-pick]")?.value;
    if (!pick) return;
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
    const offered = qualityChoices(trait, DBUCharacterData.SKILLS, DBUGearSheet.#weathers());
    if (offered.length) {
      choice = await foundry.applications.api.DialogV2.wait({
        classes: ["dbu-dialog"],
        window: { title: trait?.name ?? pick },
        content: "",
        buttons: [
          ...offered.map(key => ({ action: key,
            label: qualityChoiceLabel(trait, key, DBUCharacterData.SKILLS,
              DBUGearSheet.#weathers()) })),
          { action: "cancel", label: "Cancel" }
        ],
        rejectClose: false
      });
      if (!offered.includes(choice)) return;
    }
    const qualities = [...qualityEntries(this.item.system.crafted), { id: pick, slots, choice }];
    return this.item.update({ "system.crafted.qualities": qualities });
  }

  /** The Qualities its Category takes, ordinary and Special apart, as the picker's groups. */
  static #qualityGroups(kind, crafted) {
    const offered = traitsOfKind("crafting", kind.qualities)
      .filter(trait => qualityFits(trait, crafted.category))
      .map(trait => {
        const { min, max, ranged } = qualitySlotRange(trait);
        return { value: trait.id, label: `${trait.name} (${ranged ? `${min}-${max}` : min})`,
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
  static #inactiveNote(why, categoryName) {
    if (!why) return "";
    if (why === "category") return `Not for ${categoryName}: inactive.`;
    return `This Apparel ${why}: inactive.`;
  }

  /** Switch a Quality's toggle - Team Outfit's - by where it is in the list. */
  static async _onToggleQuality(event, target) {
    const index = Number(target.dataset.index);
    const qualities = qualityEntries(this.item.system.crafted)
      .map((entry, at) => (at === index) ? { ...entry, on: !entry.on } : entry);
    return this.item.update({ "system.crafted.qualities": qualities });
  }

  /** Take one Quality off, by where it is in the list. */
  static async _onRemoveQuality(event, target) {
    const index = Number(target.dataset.index);
    const qualities = qualityEntries(this.item.system.crafted).filter((entry, at) => at !== index);
    return this.item.update({ "system.crafted.qualities": qualities });
  }

  /**
   * Keep the assigned Character's name with their uuid, so the row can say who it is even
   * where the Actor cannot be read.
   */
  async _processSubmitData(event, form, submitData, options) {
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
