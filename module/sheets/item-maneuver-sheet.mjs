const { ItemSheetV2 } = foundry.applications.sheets;
const { HandlebarsApplicationMixin } = foundry.applications.api;

import { compile } from "../effects/parser.mjs";
import { MANEUVER_TYPES, TAIL_VARIANTS, getManeuver } from "../maneuvers.mjs";

/**
 * Sheet for a Maneuver Item.
 *
 * Mostly a form over its costs and behaviour, since that is what a Maneuver mostly is.
 * The script tab is there for the ones that carry an effect of their own - and it is
 * the same editor, with the same errors, as a Talent's.
 */
export default class DBUManeuverSheet extends HandlebarsApplicationMixin(ItemSheetV2) {

  static DEFAULT_OPTIONS = {
    classes: ["dbu-ttrpg", "maneuver"],
    position: { width: 520, height: 560 },
    window: { resizable: true },
    actions: {
      dbuChangeTab: DBUManeuverSheet._onChangeTab,
      editImage: DBUManeuverSheet._onEditImage,
      toggleSignature: DBUManeuverSheet._onToggleSignature
    },
    form: { submitOnChange: true }
  };

  static PARTS = {
    header: { template: "systems/dbu-ttrpg/templates/parts/maneuver-header.hbs" },
    tabs: { template: "systems/dbu-ttrpg/templates/parts/sheet-tabs.hbs" },
    rules: { template: "systems/dbu-ttrpg/templates/parts/maneuver-rules.hbs", scrollable: [""] },
    description: {
      template: "systems/dbu-ttrpg/templates/parts/maneuver-description.hbs",
      scrollable: [""]
    },
    effect: { template: "systems/dbu-ttrpg/templates/parts/maneuver-effect.hbs", scrollable: [""] }
  };

  tabGroups = { primary: "rules" };

  static TABS = {
    rules: { id: "rules", group: "primary", label: "Rules" },
    description: { id: "description", group: "primary", label: "Description" },
    effect: { id: "effect", group: "primary", label: "Effect" }
  };

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.item = this.item;
    context.system = this.item.system;
    context.tabs = this._getTabs();
    context.types = Object.entries(MANEUVER_TYPES)
      .map(([value, type]) => ({ value, label: type.label }));
    // formInput needs the field itself to know which editor to build.
    context.fields = this.item.system.schema.fields;

    // Whether this Maneuver is one the rules publish, which decides whose wording the
    // sheet shows: the file's for a published Maneuver, this copy's for one that exists
    // only here. Said on the tab rather than left for somebody to discover by typing
    // into a field and watching nothing change.
    const definition = getManeuver(this.item.system.maneuverId);
    context.publishedEntry = definition?.text
      ? `traits/maneuvers/${this.item.system.maneuverId}.dbu`
      : "";

    const { errors } = compile(this.item.system.script, this.item.actor?.system);
    context.errors = errors;

    // Read off the tag, which is where it lives: three rules match on it, and none of
    // them would see a separate field.
    context.isSignature = (this.item.system.tags ?? []).includes("signature");

    // The Tail Attack's one-time choice, editable here for as long as the Item exists.
    // Asked at the first use, because "when you first gain access" is a moment nothing
    // here fires on - but a choice kept for a campaign belongs somewhere a player can see
    // it and change it, and this is where the rest of their copy of a Maneuver lives.
    //
    // Drawn only on the Maneuver it is about. Every other field on this tab is one every
    // Maneuver has.
    context.tailVariants = this.item.system.tailAttack
      ? [
          { value: "", label: "Not chosen yet" },
          ...Object.entries(TAIL_VARIANTS).map(([value, variant]) => ({
            value, label: `${variant.label} - ${variant.tip}`
          })),
          { value: "none", label: "None - the Simple Profile only" }
        ]
      : null;

    context.enrichedDescription = await foundry.applications.ux.TextEditor.implementation
      .enrichHTML(this.item.system.description, { relativeTo: this.item });

    return context;
  }

  _getTabs() {
    return Object.fromEntries(Object.entries(this.constructor.TABS).map(([key, tab]) => [key, {
      ...tab,
      cssClass: this.tabGroups[tab.group] === key ? "active" : ""
    }]));
  }

  static _onChangeTab(event, target) {
    const { tab, group } = target.dataset;
    this.tabGroups[group] = tab;
    this.changeTab(tab, group, { event, navElement: target, force: true });
  }

  /**
   * Mark this Maneuver as one of the character's Signature Techniques, or unmark it.
   *
   * The tag rather than a field of its own: "any Maneuver tagged signature" is how the
   * rulebook writes the rules that care, and a second place to say the same thing is a
   * second place for it to be wrong. A checkbox cannot post one entry of a list, so it
   * is toggled here instead of submitted.
   */
  static async _onToggleSignature(event, target) {
    if (!this.isEditable) return;

    const tags = this.item.system.tags ?? [];
    const next = target.checked
      ? [...new Set([...tags, "signature"])]
      : tags.filter(tag => tag !== "signature");

    return this.item.update({ "system.tags": next });
  }

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
