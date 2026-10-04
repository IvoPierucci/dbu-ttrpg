const { ItemSheetV2 } = foundry.applications.sheets;
const { HandlebarsApplicationMixin } = foundry.applications.api;

import { compile } from "../effects/parser.mjs";
import { describeFor } from "../effects/debug.mjs";

/**
 * Sheet for a Talent Item.
 *
 * Its passives are editable as rows, so a Talent that reuses an existing rule can be
 * built here without touching any code.
 */
export default class DBUTalentSheet extends HandlebarsApplicationMixin(ItemSheetV2) {

  static DEFAULT_OPTIONS = {
    classes: ["dbu-ttrpg", "talent"],
    position: { width: 520, height: 460 },
    window: { resizable: true },
    actions: {
      dbuChangeTab: DBUTalentSheet._onChangeTab,
      editImage: DBUTalentSheet._onEditImage
    },
    form: { submitOnChange: true }
  };

  static PARTS = {
    header: { template: "systems/dbu-ttrpg/templates/parts/talent-header.hbs" },
    tabs: { template: "systems/dbu-ttrpg/templates/parts/sheet-tabs.hbs" },
    description: {
      template: "systems/dbu-ttrpg/templates/parts/talent-description.hbs",
      scrollable: [""]
    },
    // A Racial Trait's Options, between its Description and its Passives (the user's) - a Talent has none.
    options: { template: "systems/dbu-ttrpg/templates/parts/talent-options.hbs", scrollable: [""] },
    passives: { template: "systems/dbu-ttrpg/templates/parts/talent-passives.hbs", scrollable: [""] }
  };

  tabGroups = { primary: "description" };

  static TABS = {
    description: { id: "description", group: "primary", label: "Description" },
    options: { id: "options", group: "primary", label: "Options" },
    passives: { id: "passives", group: "primary", label: "Passives" }
  };

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.item = this.item;
    context.system = this.item.system;
    // formInput needs the field itself to know what editor to build.
    context.fields = this.item.system.schema.fields;
    context.enrichedDescription = await foundry.applications.ux.TextEditor.implementation.enrichHTML(
      this.item.system.description,
      { relativeTo: this.item }
    );
    context.tabs = this._getTabs();
    // Its text as printed, under its description - a Talent's and a Racial Trait's (the user's).
    const { racialTraitLines } = await import("../racial.mjs");
    context.textLines = racialTraitLines(this.item);
    // A Racial Trait: its race and what the rules call it in place of Prerequisites, and what was chosen for it.
    if (this.item.type === "racial") {
      const { ordinal, racialOptionOf, racialOptionsOf, racialTraitKind, racialTraitRace } = await import("../racial.mjs");
      const { getTrait, printedLines } = await import("../effects/traits.mjs");
      const file = getTrait(this.item.flags?.["dbu-ttrpg"]?.sourceId ?? "");
      const current = racialOptionOf(this.item);
      // Its Options, where it has an Option effect - the one chosen picked, and the rest there to change to.
      const options = racialOptionsOf(this.item.flags?.["dbu-ttrpg"]?.sourceId ?? "")
        .map(option => ({ value: option.id, label: option.name, selected: option.id === current }));
      context.racial = {
        race: racialTraitRace(this.item.system.race, this.item.system.subrace),
        kind: racialTraitKind(this.item.system),
        chosen: (this.item.system.chosen ?? []).filter(entry => entry.key !== "option").map(entry => entry.label)
          .filter(Boolean).join(" \u00b7 "),
        options: options.length ? options : null,
        // Which printed effect asks for it - "3rd effect" (the user's).
        optionLabel: Number(file?.optionEffect) ? `${ordinal(Number(file.optionEffect))} effect` : "Option",
        // Its Addendum, as written - for whoever is choosing to read before they choose.
        addendum: String(file?.addendum ?? "").trim()
          ? printedLines(String(file.addendum)).map(line => ({ text: line, bullet: /^[*\u2022]/.test(line), gap: !line }))
          : null,
        addendumTitle: String(file?.addendumTitle ?? "Addendum"),
        // A tail it may lose: kept on the character, the Tailed Option's `tailed`.
        tail: file?.tail === true,
        tailLost: Boolean(this.item.actor?.getFlag?.("dbu-ttrpg", "tailLost"))
      };
    }

    // Compiled every time the sheet is drawn, so a mistake is reported as it is made.
    // The character is passed in when there is one, which is what lets a slot name be
    // checked against the Skills and Attributes that actually exist.
    const owner = this.item.actor;
    const { program, errors } = compile(this.item.system.script, owner?.system);
    context.errors = errors;
    context.actorName = owner?.name ?? "";
    context.resolved = (owner && !errors.length) ? describeFor(program, owner) : [];

    return context;
  }

  /** A Racial Trait's Option changed from its dropdown: its script, choice and what it gives changed with it. */
  _onRender(context, options) {
    super._onRender?.(context, options);
    // A tail lost, or regrown: on the character, what Tailed asks.
    this.element.querySelector("input[data-tail-lost]")?.addEventListener("change", async event => {
      event.stopPropagation();
      await this.item.actor?.setFlag("dbu-ttrpg", "tailLost", event.target.checked);
    });
    const select = this.element.querySelector("select[data-racial-option]");
    if (!select) return;
    select.addEventListener("change", async event => {
      event.stopPropagation();
      const { changeRacialOption } = await import("../racial.mjs");
      const changed = await changeRacialOption(this.item, event.target.value);
      if (!changed) this.render();
    });
  }

  /** Build the tab configuration used by the shared tabs template. */
  _getTabs() {
    // The Options tab is a Racial Trait's alone - shown on every one, empty where it has none.
    return Object.fromEntries(Object.entries(this.constructor.TABS)
      .filter(([key]) => (key !== "options") || (this.item.type === "racial")).map(([key, tab]) => [key, {
      ...tab,
      cssClass: this.tabGroups[tab.group] === key ? "active" : ""
    }]));
  }

  static _onChangeTab(event, target) {
    const { tab, group } = target.dataset;
    this.tabGroups[group] = tab;
    this.changeTab(tab, group, { event, navElement: target, force: true });
  }

  /** Handle clicking the icon to pick a new image. */
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
