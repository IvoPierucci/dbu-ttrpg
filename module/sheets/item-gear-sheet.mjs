const { ItemSheetV2 } = foundry.applications.sheets;
const { HandlebarsApplicationMixin } = foundry.applications.api;

import { getTrait, printedLines } from "../effects/traits.mjs";
import { GEAR_TAGS, GEAR_TRIGGERS, GEAR_TYPES, connectable } from "../gear.mjs";

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
      editImage: DBUGearSheet._onEditImage
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
    context.chargesLabel = (system.chargesDice || system.storesDrain)
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
    context.hasControls = Boolean(context.recordsLabel || context.triggerChoices.length
      || context.chargesLabel || context.connects || context.upgrade || context.assigns);

    // The file's entry where the file still has one, and the copy's otherwise - the rules
    // live in traits/, and a copy made last week holds last week's wording.
    const entry = getTrait(system.gearId)?.text || system.text;
    context.entry = printedLines(entry).map(line => ({ text: line, gap: !line }));

    return context;
  }

  /**
   * Keep the assigned Character's name with their uuid, so the row can say who it is even
   * where the Actor cannot be read.
   */
  async _processSubmitData(event, form, submitData, options) {
    const uuid = foundry.utils.getProperty(submitData, "system.assigned.uuid");
    if (uuid !== undefined) {
      foundry.utils.setProperty(submitData, "system.assigned.name",
        uuid ? (fromUuidSync(uuid)?.name ?? "") : "");
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
