const { ActorSheetV2 } = foundry.applications.sheets;
const { HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

import DBUCharacterData from "../data/actor-character.mjs";
import { isCharacter } from "../actor-types.mjs";
import { getTrait, printedLines } from "../effects/traits.mjs";
import { actorAt, battleEnvironments, environmentName, MAX_VEHICLE_LEVEL, qualitySlotRange, VEHICLE_GRADES, VEHICLE_SIZES,
  vehicleQualities } from "../vehicles.mjs";

/** The flag a Vehicle Weapon carries on its Vehicle: which of Weapon Installed's it is, and the one Profile it makes. */
const VEHICLE_WEAPON = "vehicleWeapon";
const VEHICLE_PROFILE = "vehicleProfile";

/**
 * A Vehicle's sheet (the user's design, 2026-11-15): a header as a Character's - square picture, its name with Level, Grade, Size
 * and Output beside it, Life, and Ki with the Capacity beside it - then Main (who is in it, and the Aptitudes it uses), Qualities
 * (its Vehicle Qualities and Vehicle Weapons) and Creation (what it was made with).
 */
export default class DBUVehicleSheet extends HandlebarsApplicationMixin(ActorSheetV2) {

  static DEFAULT_OPTIONS = {
    classes: ["dbu-ttrpg", "vehicle"],
    position: { width: 640, height: 640 },
    window: { resizable: true },
    actions: {
      dbuChangeTab: DBUVehicleSheet._onChangeTab,
      editImage: DBUVehicleSheet._onEditImage,
      addQuality: DBUVehicleSheet._onAddQuality,
      deleteQuality: DBUVehicleSheet._onDeleteQuality,
      toggleQuality: DBUVehicleSheet._onToggleQuality,
      buildWeapon: DBUVehicleSheet._onBuildWeapon,
      openCrew: DBUVehicleSheet._onOpenCrew,
      pickSeat: DBUVehicleSheet._onPickSeat,
      tuneUp: DBUVehicleSheet._onTuneUp
    },
    form: { submitOnChange: true }
  };

  static PARTS = {
    header: { template: "systems/dbu-ttrpg/templates/parts/vehicle-header.hbs" },
    tabs: { template: "systems/dbu-ttrpg/templates/parts/sheet-tabs.hbs" },
    main: { template: "systems/dbu-ttrpg/templates/parts/vehicle-main.hbs", scrollable: [""] },
    qualities: { template: "systems/dbu-ttrpg/templates/parts/vehicle-qualities.hbs", scrollable: [""] },
    creation: { template: "systems/dbu-ttrpg/templates/parts/vehicle-creation.hbs", scrollable: [""] }
  };

  tabGroups = { primary: "main" };

  static TABS = {
    main: { id: "main", group: "primary", label: "Main" },
    qualities: { id: "qualities", group: "primary", label: "Qualities" },
    creation: { id: "creation", group: "primary", label: "Creation" }
  };

  /** The Vehicle Qualities opened to their text, by index - kept through a render. */
  #open = new Set();

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const actor = this.actor;
    const system = actor.system;
    const reading = system.reading;
    context.actor = actor;
    context.system = system;
    context.reading = reading;
    context.editable = this.isEditable;
    context.tabs = Object.fromEntries(Object.entries(this.constructor.TABS).map(([key, tab]) => [key, {
      ...tab, cssClass: (this.tabGroups[tab.group] === key) ? "active" : "" }]));

    const percent = (value, max) => (max ? Math.min(100, Math.max(0, Math.round((value / max) * 100))) : 0);
    context.lifePercent = percent(system.life.value, system.life.max);
    context.kiPercent = percent(system.ki.value, system.ki.max);
    context.capacity = reading.capacity;
    context.capacityPercent = percent(reading.capacity.left, reading.capacity.max);

    // Main: who is in it, and the Aptitudes it uses.
    const member = (uuid, role) => {
      const who = actorAt(uuid);
      return { uuid, role, name: who?.name ?? "Unknown", img: who?.img ?? "icons/svg/mystery-man.svg", missing: !who };
    };
    const pilot = system.crew.pilot ? member(system.crew.pilot, "Pilot") : null;
    const passengers = (system.crew.passengers ?? []).map(uuid => member(uuid, "Passenger"));
    context.crew = { pilot, passengers, inside: (pilot ? 1 : 0) + passengers.length, squares: reading.size.squares,
      seatNeeded: this.#seatNeeded(), seat: this.#seatName(system.pilotSeat) };
    context.aptitudes = [
      { label: "Speed", value: `${reading.speed.normal} sq.`, tip: reading.workings.speed },
      { label: "Speed (Boosted)", value: `${reading.speed.boosted} sq.`, tip: reading.workings.boosted },
      { label: "Might", value: reading.might, tip: reading.workings.might },
      { label: "Soak Value", value: reading.soakValue, tip: reading.workings.soakValue },
      { label: "Defense Value", value: reading.defenseValue, tip: reading.workings.defenseValue },
      { label: "Damage Reduction", value: reading.damageReduction, tip: reading.workings.damageReduction },
      { label: "Hardness", value: reading.hardness, tip: reading.workings.hardness },
      { label: "Squares", value: `${reading.size.cols}×${reading.size.rows}`, tip: reading.workings.squares }
    ];

    // Qualities: each with what it does, its choice, its Slots and what it asks; Weapon Installed's Vehicle Weapons under it.
    const environments = battleEnvironments().map(trait => ({ value: trait.id, label: trait.name }));
    const weapons = actor.items.filter(item => (item.type === "gear") && (item.getFlag("dbu-ttrpg", VEHICLE_WEAPON) !== undefined));
    const { PROFILES } = await import("../maneuvers.mjs");
    context.qualities = reading.qualities.map((quality, index) => {
      const file = getTrait(quality.id);
      return {
        ...quality,
        index,
        open: this.#open.has(index),
        text: printedLines(String(file?.text ?? "")).map(line => ({ text: line, gap: !line })),
        chooses: Array.from({ length: quality.choose }, (each, at) => ({
          at,
          options: [{ value: "", label: "-", selected: !quality.choices[at] },
            ...environments.map(option => ({ ...option, selected: option.value === quality.choices[at] }))]
        })),
        weaponRows: Array.from({ length: quality.weapons }, (each, at) => {
          const weapon = weapons.find(item => Number(item.getFlag("dbu-ttrpg", VEHICLE_WEAPON)) === at);
          const type = weapon?.system?.crafted?.weaponType ?? "";
          const chosen = weapon?.getFlag("dbu-ttrpg", VEHICLE_PROFILE) ?? "";
          return {
            at,
            id: weapon?.id ?? "",
            name: weapon?.name ?? `Vehicle Weapon ${at + 1}`,
            built: Boolean(weapon),
            type: type ? (type.charAt(0).toUpperCase() + type.slice(1)) : "",
            wrongType: Boolean(weapon) && !["energy", "magic"].includes(type),
            profiles: weapon ? [{ value: "", label: "Profile: -", selected: !chosen },
              ...Object.entries(PROFILES).filter(([, profile]) => (profile.foundations ?? []).includes(type))
                .map(([value, profile]) => ({ value, label: `Profile: ${profile.label}`, selected: value === chosen }))] : []
          };
        })
      };
    });
    context.slots = reading.slots;

    // Creation: what it was made with.
    context.grades = VEHICLE_GRADES.map(row => ({ value: row.grade, selected: row.grade === reading.grade,
      label: `${row.grade} · ${DBUCharacterData.DIFFICULTIES[row.difficulty].label}` }));
    context.gradeNote = `Craft DC ${DBUCharacterData.DIFFICULTIES[reading.gradeRow.difficulty].label} (${DBUCharacterData.DIFFICULTIES[reading.gradeRow.difficulty].tn}) · ${reading.gradeRow.slots} Quality Slot${reading.gradeRow.slots === 1 ? "" : "s"}`;
    context.sizes = VEHICLE_SIZES.map(key => ({ value: key, label: DBUCharacterData.SIZES[key].label, selected: key === system.size }));
    context.sizeNote = `${reading.size.cols}×${reading.size.baseRows} Square${(reading.size.cols * reading.size.baseRows) === 1 ? "" : "s"}`
      + ((reading.size.key !== reading.madeSize) ? ` · ${reading.size.label} by Ultra-Massive` : "");
    context.maxLevel = MAX_VEHICLE_LEVEL;
    const creator = actorAt(system.creator);
    context.creators = [{ value: "", label: "-", selected: !system.creator },
      ...game.actors.filter(each => isCharacter(each) && each.visible)
        .map(each => ({ value: each.uuid, label: each.name, selected: each.uuid === system.creator }))
        .sort((a, b) => a.label.localeCompare(b.label))];
    if (system.creator && !creator) context.creators.push({ value: system.creator, label: "(not found)", selected: true });
    context.creatorNote = creator ? ["knowledge", "craftWeapons", "useMagic"]
      .map(key => `${DBUCharacterData.SKILLS[key].label} ${Number(creator.system?.skills?.[key]?.ranks) || 0}`).join(", ") : "";
    context.seat = this.#seatNeeded() ? {
      cols: reading.size.cols,
      cells: Array.from({ length: reading.size.squares }, (each, index) => ({ index, on: index === system.pilotSeat,
        extra: Math.floor(index / reading.size.cols) >= reading.size.baseRows }))
    } : null;
    return context;
  }

  /** Enormous or larger: a Pilot Seat to pick. */
  #seatNeeded() {
    return (this.actor.system.reading?.size?.cols ?? 1) > 1;
  }

  /** A Square's place, said: "Row 1, Square 2". */
  #seatName(index) {
    if (!this.#seatNeeded()) return "";
    const cols = this.actor.system.reading.size.cols;
    return `Row ${Math.floor(index / cols) + 1}, Square ${(index % cols) + 1}`;
  }

  /** A Quality's own boxes - its Slots and its choices - written as the sheet's form never could: an array's entry. */
  _onRender(context, options) {
    super._onRender?.(context, options);
    for (const input of this.element.querySelectorAll("[data-quality-slots]")) {
      input.addEventListener("change", event => {
        event.stopPropagation();
        const index = Number(input.dataset.qualitySlots);
        return this.#writeQuality(index, entry => {
          const range = qualitySlotRange(getTrait(entry.id));
          entry.slots = Math.min(range.max, Math.max(range.min, Math.floor(Number(input.value) || range.min)));
        });
      });
    }
    for (const select of this.element.querySelectorAll("select[data-quality-choice]")) {
      select.addEventListener("change", event => {
        event.stopPropagation();
        const [index, at] = select.dataset.qualityChoice.split(":").map(Number);
        return this.#writeQuality(index, entry => {
          const choices = [...(entry.choices ?? [])];
          while (choices.length <= at) choices.push("");
          choices[at] = select.value;
          entry.choices = choices;
        });
      });
    }
    for (const select of this.element.querySelectorAll("select[data-weapon-profile]")) {
      select.addEventListener("change", event => {
        event.stopPropagation();
        return this.actor.items.get(select.dataset.weaponProfile)?.setFlag("dbu-ttrpg", VEHICLE_PROFILE, select.value);
      });
    }
    // The header's Capacity, said as what is left while kept as what was spent - as a Character's (data-capacity-left).
    for (const field of this.element.querySelectorAll("[data-capacity-left]")) {
      field.addEventListener("change", event => {
        event.stopPropagation();
        const max = Number(this.actor.system.capacity?.max) || 0;
        return this.actor.update({ "system.capacity.spent": Math.max(0, max - Math.floor(Number(field.value) || 0)) });
      });
    }
  }

  /** One Vehicle Quality changed, the whole list written back. */
  async #writeQuality(index, change) {
    const qualities = foundry.utils.deepClone(this.actor.system.toObject().qualities ?? []);
    if (!qualities[index]) return;
    change(qualities[index]);
    return this.actor.update({ "system.qualities": qualities });
  }

  /**
   * Add Quality: the catalogue, searchable - every one addable, one that does not fit in gray with why (the user's: warned, never
   * refused).
   */
  static async _onAddQuality() {
    if (!this.isEditable) return;
    const system = this.actor.system;
    const ids = system.qualities.map(entry => entry.id);
    const { qualityWarnings } = await import("../vehicles.mjs");
    const left = system.reading.slots.have - system.reading.slots.used;
    const rows = vehicleQualities().map(definition => {
      const warnings = qualityWarnings(definition, { grade: system.reading.grade, size: system.reading.madeSize, qualityIds: ids,
        creator: actorAt(system.creator) });
      const range = qualitySlotRange(definition);
      const slots = (range.max > range.min) ? `${range.min} to ${range.max} Slots` : `${range.min} Slot${range.min === 1 ? "" : "s"}`;
      const why = [...warnings, ...(definition.waits ? [String(definition.waits)] : [])].join(" ");
      return `<div class="dbu-vq-pick${warnings.length ? " unfit" : ""}" data-name="${definition.name.toLowerCase()}">
        <span class="dbu-vq-pick-name">${definition.name}</span>
        <span class="dbu-vq-pick-note">${slots}${why ? ` · ${foundry.utils.escapeHTML(why)}` : ""}</span>
        <button type="button" data-pick="${definition.id}">Add</button></div>`;
    }).join("");
    let id = null;
    await DialogV2.wait({
      window: { title: "Add a Vehicle Quality" },
      classes: ["dbu-dialog", "dbu-vq-catalog"],
      content: `<p class="dbu-vq-left">${left} Quality Slot${left === 1 ? "" : "s"} left</p>
        <input type="search" class="dbu-vq-search" placeholder="Search..." autocomplete="off"/>
        <div class="dbu-vq-list">${rows}</div>`,
      buttons: [{ action: "close", label: "Close" }],
      render: (event, dialog) => {
        const root = dialog.element;
        const search = root.querySelector(".dbu-vq-search");
        search?.addEventListener("input", () => {
          const query = search.value.trim().toLowerCase();
          for (const row of root.querySelectorAll(".dbu-vq-pick")) row.hidden = Boolean(query) && !row.dataset.name.includes(query);
        });
        for (const button of root.querySelectorAll("button[data-pick]")) {
          button.addEventListener("click", () => {
            id = button.dataset.pick;
            dialog.close();
          });
        }
      },
      rejectClose: false
    }).catch(() => null);
    if (!id) return;
    const range = qualitySlotRange(getTrait(id));
    const qualities = [...system.toObject().qualities, { id, slots: range.min, choices: [] }];
    return this.actor.update({ "system.qualities": qualities });
  }

  /** A Vehicle Quality taken off - and, Weapon Installed's going, nothing else: its Vehicle Weapons stay, to be deleted by hand. */
  static async _onDeleteQuality(event, target) {
    if (!this.isEditable) return;
    const index = Number(target.dataset.index);
    const qualities = this.actor.system.toObject().qualities.filter((each, at) => at !== index);
    this.#open.clear();
    return this.actor.update({ "system.qualities": qualities });
  }

  /** A Vehicle Quality's text opened or closed. */
  static _onToggleQuality(event, target) {
    const index = Number(target.dataset.index);
    if (this.#open.has(index)) this.#open.delete(index);
    else this.#open.add(index);
    this.render({ parts: ["qualities"] });
  }

  /**
   * Build: a Vehicle Weapon's sheet opened - made first if it is not yet, with the Weapon builder every Weapon has: "a Craftsmanship
   * Grade equal to that of this Vehicle", an Energy Weapon ("Your Vehicle Weapon must be an Energy Weapon").
   */
  static async _onBuildWeapon(event, target) {
    const existing = target.dataset.itemId ? this.actor.items.get(target.dataset.itemId) : null;
    if (existing) return existing.sheet.render(true);
    if (!this.isEditable) return;
    const { craftedItemFrom } = await import("../gear.mjs");
    const data = craftedItemFrom("weapon", this.actor, getTrait);
    if (!data) return;
    const at = Number(target.dataset.at) || 0;
    data.name = `Vehicle Weapon ${at + 1}`;
    data.system.crafted.grade = this.actor.system.reading.grade;
    data.system.crafted.weaponType = "energy";
    data.flags = { "dbu-ttrpg": { [VEHICLE_WEAPON]: at, [VEHICLE_PROFILE]: "" } };
    const [made] = await this.actor.createEmbeddedDocuments("Item", [data]);
    return made?.sheet.render(true);
  }

  /** A Pilot's or a Passenger's sheet, opened. */
  static _onOpenCrew(event, target) {
    return actorAt(target.dataset.uuid)?.sheet?.render(true);
  }

  /** The Pilot Seat: the Square clicked. */
  static _onPickSeat(event, target) {
    if (!this.isEditable) return;
    return this.actor.update({ "system.pilotSeat": Number(target.dataset.index) || 0 });
  }

  /**
   * Tune Up (the user's: the button kept on Creation): "A Vehicle's Vehicle Level can be increased to match that of its current owner
   * by using the Tune Up Maneuver" - the Character asked, its Power Level written.
   */
  static async _onTuneUp() {
    if (!this.isEditable) return;
    const owners = game.actors.filter(each => isCharacter(each) && each.isOwner);
    if (!owners.length) return ui.notifications.warn("No Character of yours to Tune it Up.");
    const chosen = await DialogV2.wait({
      window: { title: `Tune Up: ${this.actor.name}` },
      classes: ["dbu-dialog"],
      content: `<p>Its Vehicle Level becomes the Power Level of:</p>
        <select name="owner">${owners.map(each => `<option value="${each.id}">${foundry.utils.escapeHTML(each.name)} (Power Level ${each.system.powerLevel})</option>`).join("")}</select>`,
      buttons: [
        { action: "tune", label: "Tune Up", default: true, callback: (event, button) => button.form.elements.owner.value },
        { action: "cancel", label: "Cancel" }
      ],
      rejectClose: false
    }).catch(() => null);
    const owner = game.actors.get(chosen);
    if (!owner) return;
    const level = Math.min(MAX_VEHICLE_LEVEL, Math.max(1, Number(owner.system.powerLevel) || 1));
    await this.actor.update({ "system.vehicleLevel": level });
    ui.notifications.info(`${this.actor.name} Tuned Up to Vehicle Level ${level}, ${owner.name}'s Power Level.`);
  }

  static _onChangeTab(event, target) {
    const { tab, group } = target.dataset;
    this.tabGroups[group] = tab;
    this.changeTab(tab, group, { event, navElement: target, force: true });
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
