const { ItemSheetV2 } = foundry.applications.sheets;
const { HandlebarsApplicationMixin } = foundry.applications.api;

import { compile } from "../effects/parser.mjs";
import { getTrait, traitsOfKind } from "../effects/traits.mjs";
import { MANEUVER_TYPES, PROFILES, SUPER_PROFILES, TAIL_VARIANTS, getManeuver } from "../maneuvers.mjs";
import { namePrefixMatches } from "../gear.mjs";
import DBUCharacterData from "../data/actor-character.mjs";
import {
  LEVELS, choiceLabel, composeTechniqueEffects, featureCatalogue, featureDef, featureProblem,
  featureTP, isUltimate, maxRanks, profileKiPerTier, signatureOf, superProfileKiPerTier,
  superProfileProblem, techniqueKiPerTier, techniqueTP, techniqueTPCharged, tierTpCap
} from "../technique.mjs";

/**
 * Sheet for a Maneuver Item.
 *
 * Mostly a form over its costs and behaviour, since that is what a Maneuver mostly is.
 * The script tab is there for the ones that carry an effect of their own - and it is
 * the same editor, with the same errors, as a Talent's.
 *
 * A Signature Technique is built here instead, the way an Apparel is built on its own sheet:
 * Description, Sig Creation (its level, Foundation and Profile, and what it all costs), Adv &
 * Disadv (what it was built out of) and Effects (the pseudo-code its features write).
 */
export default class DBUManeuverSheet extends HandlebarsApplicationMixin(ItemSheetV2) {

  static DEFAULT_OPTIONS = {
    classes: ["dbu-ttrpg", "maneuver"],
    position: { width: 540, height: 600 },
    window: { resizable: true },
    actions: {
      dbuChangeTab: DBUManeuverSheet._onChangeTab,
      editImage: DBUManeuverSheet._onEditImage,
      addFeature: DBUManeuverSheet._onAddFeature,
      removeFeature: DBUManeuverSheet._onRemoveFeature,
      rankFeature: DBUManeuverSheet._onRankFeature,
      chooseFeature: DBUManeuverSheet._onChooseFeature,
      resyncTechnique: DBUManeuverSheet._onResyncTechnique
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
    effect: { template: "systems/dbu-ttrpg/templates/parts/maneuver-effect.hbs", scrollable: [""] },
    creation: { template: "systems/dbu-ttrpg/templates/parts/technique-creation.hbs", scrollable: [""] },
    features: { template: "systems/dbu-ttrpg/templates/parts/technique-features.hbs", scrollable: [""] },
    techniqueEffects: {
      template: "systems/dbu-ttrpg/templates/parts/technique-effects.hbs", scrollable: [""]
    }
  };

  tabGroups = { primary: "" };

  static TABS = {
    rules: { id: "rules", group: "primary", label: "Rules" },
    description: { id: "description", group: "primary", label: "Description" },
    effect: { id: "effect", group: "primary", label: "Effect" }
  };

  /** A Signature Technique's four, in the user's order. */
  static TECHNIQUE_TABS = {
    description: { id: "description", group: "primary", label: "Description" },
    creation: { id: "creation", group: "primary", label: "Sig Creation" },
    features: { id: "features", group: "primary", label: "Adv & Disadv" },
    techniqueEffects: { id: "techniqueEffects", group: "primary", label: "Effects" }
  };

  /** Whether this Maneuver is a Signature Technique of its owner's: read off the tag. */
  get #technique() {
    return (this.item.system.tags ?? []).includes("signature") && !this.item.system.signatureTechnique;
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.item = this.item;
    context.system = this.item.system;
    context.isTechnique = this.#technique;
    const tabs = context.isTechnique ? this.constructor.TECHNIQUE_TABS : this.constructor.TABS;
    if (!tabs[this.tabGroups.primary]) this.tabGroups.primary = context.isTechnique ? "creation" : "rules";
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

    if (context.isTechnique) context.technique = this.#techniqueContext();
    return context;
  }

  /** What the three Technique tabs show. */
  #techniqueContext() {
    const sig = signatureOf(this.item);
    const actor = this.item.actor ?? null;
    const tier = actor?.system?.tierOfPower ?? 1;
    const baseTier = actor?.system?.baseTierOfPower ?? 1;

    const foundations = Object.entries(DBUCharacterData.FOUNDATIONS)
      .map(([value, entry]) => ({ value, label: entry.label, chosen: value === sig.foundation }));
    const profiles = Object.entries(PROFILES)
      .filter(([, profile]) => !sig.foundation || (profile.foundations ?? []).includes(sig.foundation))
      .map(([value, profile]) => ({ value, label: `${profile.label} (${profile.kiCostPerTier ?? 0}(T))`,
        chosen: value === sig.profile }));
    const dramatic = sig.level === "dramatic";
    // Both lists are always drawn, closed where they do not apply, so nothing on the tab moves when
    // the Level or the Super Profile changes.
    const superProfiles = Object.entries(SUPER_PROFILES).map(([value, entry]) => ({ value, label: entry.label,
      chosen: dramatic && (value === sig.superProfile), tip: entry.text }));
    const multi = dramatic && (sig.superProfile === "multi-profile");
    const secondProfiles = Object.entries(PROFILES).filter(([value]) => value !== sig.profile)
      .map(([value, profile]) => ({ value, label: `${profile.label} (${profile.kiCostPerTier ?? 0}(T))`,
        chosen: multi && (value === sig.secondProfile) }));

    const tp = techniqueTP(sig);
    const cap = tierTpCap(baseTier);
    const kiPerTier = techniqueKiPerTier(sig);
    const profileKi = profileKiPerTier(sig.profile);
    const superKi = sig.superProfile ? superProfileKiPerTier(sig.superProfile, sig.secondProfile) : 0;

    const reading = {
      tp,
      free: sig.freeTP,
      charged: techniqueTPCharged(sig),
      cap,
      over: tp > cap ? `Over the ${cap} TP a Technique may be worth at base Tier ${baseTier}.` : "",
      profileKi,
      techniqueKi: kiPerTier - superKi,
      superKi,
      totalPerTier: profileKi + kiPerTier,
      total: (profileKi + kiPerTier) * tier,
      tier,
      superProblem: sig.superProfile ? superProfileProblem(sig.superProfile, sig, { actor }) : "",
      unbuilt: !sig.profile
    };

    // The features on it, each with what it costs and anything wrong with it.
    const rows = sig.features.map((entry, index) => {
      const def = featureDef(entry.id);
      const top = maxRanks(def);
      return {
        index,
        id: entry.id,
        name: def?.name ?? entry.id,
        side: (def?.owner === "disadvantages") ? "Disadvantage" : "Advantage",
        ranks: entry.ranks,
        ranked: top > 1,
        canUp: entry.ranks < top,
        canDown: entry.ranks > 1,
        tp: featureTP(def, entry.ranks),
        choose: def?.choose ?? "",
        choiceLabel: entry.choice ? choiceLabel(def, entry.choice) : (def?.choose ? "Not chosen" : ""),
        problem: featureProblem(entry.id, sig, { actor }),
        disadvantage: def?.owner === "disadvantages",
        tip: def?.summary ?? "",
        // Its text as printed, in the card under its controls: one entry a printed line, a blank
        // one a paragraph break, the bullets the text's own.
        lines: String(def?.text ?? "").split("\n").map(line => line.trim())
          .map(line => (line ? { text: line, bullet: /^[*•]/.test(line) } : { gap: true }))
      };
    });

    // What can be added: every feature not already on it, greyed where its Requirement fails.
    const catalogue = featureCatalogue();
    const has = new Set(sig.features.map(entry => entry.id));
    const group = (label, list) => ({
      label,
      choices: list.filter(def => !has.has(def.id)).map(def => {
        const problem = featureProblem(def.id, { ...sig, features: [...sig.features, { id: def.id, ranks: 1, choice: "" }] },
          { actor });
        const prices = [].concat(def.tpCostPerRank ?? def.tpCost).join("/");
        return { value: def.id, name: def.name, label: `${def.name} (${prices} TP)`, blocked: problem };
      })
    });

    return {
      levels: Object.entries(LEVELS).map(([value, level]) => ({ value, label: level.label,
        chosen: value === sig.level })),
      foundations,
      profiles,
      superProfiles,
      secondProfiles,
      dramatic,
      multi,
      ultimate: isUltimate(sig.level),
      fromTransformation: sig.fromTransformation,
      freeTP: sig.freeTP,
      reading,
      rows,
      groups: [group("Advantages", catalogue.advantages), group("Disadvantages", catalogue.disadvantages)],
      script: this.item.system.script,
      errors: compile(this.item.system.script, this.item.actor?.system).errors
    };
  }

  _getTabs() {
    const tabs = this.#technique ? this.constructor.TECHNIQUE_TABS : this.constructor.TABS;
    return Object.fromEntries(Object.entries(tabs).map(([key, tab]) => [key, {
      ...tab,
      cssClass: this.tabGroups[tab.group] === key ? "active" : ""
    }]));
  }

  /** @override */
  async _onRender(context, options) {
    await super._onRender(context, options);
    this.#wireFeatureSearch();
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
  // --- The Adv & Disadv tab ---------------------------------------------------------------------

  /** An update that changes the features, with the Effects they write. */
  #withFeatures(features) {
    const sig = signatureOf(this.item);
    return {
      "system.signature.features": features,
      "system.script": composeTechniqueEffects({ ...sig, features }, this.item.system.script ?? "")
    };
  }

  /** The Add search, the way the Apparel sheet's Add Quality search works. */
  #wireFeatureSearch() {
    const input = this.element.querySelector("[data-feature-search]");
    const list = this.element.querySelector("[data-feature-list]");
    if (!input || !list) return;
    const options = [...list.querySelectorAll("[data-feature-option]")];
    const groups = [...list.querySelectorAll("[data-feature-group]")];
    const none = list.querySelector("[data-feature-none]");
    const shown = () => options.filter(option => !option.hidden);
    const lit = () => options.find(option => option.classList.contains("active"));
    const light = option => {
      for (const each of options) each.classList.toggle("active", each === option);
      if (!option) return;
      const top = option.offsetTop;
      const bottom = top + option.offsetHeight;
      if (top < list.scrollTop) list.scrollTop = top;
      else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
    };
    const filter = () => {
      for (const option of options) option.hidden = !namePrefixMatches(option.dataset.name, input.value);
      for (const group of groups) {
        group.hidden = !options.some(option => !option.hidden
          && (option.dataset.group === group.dataset.featureGroup));
      }
      if (none) none.hidden = shown().length > 0;
      light(shown()[0]);
    };
    const open = () => { list.hidden = false; filter(); };
    const pick = option => {
      input.value = option.dataset.name;
      input.dataset.picked = option.dataset.featureOption;
      list.hidden = true;
    };
    input.addEventListener("focus", open);
    input.addEventListener("click", () => list.hidden && open());
    input.addEventListener("input", () => { delete input.dataset.picked; open(); });
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
        event.preventDefault();
        if (!list.hidden && lit()) pick(lit());
        else if (input.dataset.picked) DBUManeuverSheet._onAddFeature.call(this, event, input);
      } else if ((event.key === "Escape") && !list.hidden) {
        event.preventDefault();
        event.stopPropagation();
        list.hidden = true;
      }
    });
    list.addEventListener("mousedown", event => {
      event.preventDefault();
      const option = event.target.closest("[data-feature-option]");
      if (option) pick(option);
    });
  }

  /** Which feature the search means: the one picked, or the first whose name starts so. */
  #pickedFeature() {
    const input = this.element.querySelector("[data-feature-search]");
    if (!input) return "";
    if (input.dataset.picked) return input.dataset.picked;
    if (!input.value.trim()) return "";
    return [...this.element.querySelectorAll("[data-feature-option]")]
      .find(option => namePrefixMatches(option.dataset.name, input.value))?.dataset.featureOption ?? "";
  }

  /**
   * Add a feature. One whose Requirement is not met is warned about and added anyway, the way an
   * Apparel's Quality over its Slots is: the Requirement is shown on its row until it is met.
   * One that makes a choice - Widespread's shape, Condition's Condition - asks for it now.
   */
  static async _onAddFeature(event, target) {
    if (!this.isEditable) return;
    const pick = this.#pickedFeature();
    if (!pick) return this.element.querySelector("[data-feature-search]")?.focus();
    const def = featureDef(pick);
    if (!def) return;
    const sig = signatureOf(this.item);
    if (sig.features.some(entry => entry.id === pick)) return;
    const choice = def.choose ? await this.#askChoice(def, 1, sig) : "";
    if (choice === null) return;
    const features = [...sig.features, { id: pick, ranks: 1, choice }];
    const problem = featureProblem(pick, { ...sig, features }, { actor: this.item.actor ?? null });
    if (problem) ui.notifications.warn(`${def.name}: ${problem}`);
    return this.item.update(this.#withFeatures(features));
  }

  static async _onRemoveFeature(event, target) {
    if (!this.isEditable) return;
    const index = Number(target.dataset.index);
    const features = signatureOf(this.item).features.filter((entry, at) => at !== index);
    return this.item.update(this.#withFeatures(features));
  }

  /** A rank up or down. Restricted - Weapon's second rank chooses a Weapon instead of a Category. */
  static async _onRankFeature(event, target) {
    if (!this.isEditable) return;
    const index = Number(target.dataset.index);
    const step = Number(target.dataset.step) || 0;
    const sig = signatureOf(this.item);
    const entry = sig.features[index];
    const def = featureDef(entry?.id);
    if (!entry || !def) return;
    const ranks = Math.max(1, Math.min(maxRanks(def), entry.ranks + step));
    if (ranks === entry.ranks) return;
    let choice = entry.choice;
    if ((def.choose === "weapon") && (ranks !== entry.ranks)) {
      choice = await this.#askChoice(def, ranks, sig);
      if (choice === null) return;
    }
    const features = sig.features.map((each, at) => (at === index) ? { ...each, ranks, choice } : each);
    return this.item.update(this.#withFeatures(features));
  }

  static async _onChooseFeature(event, target) {
    if (!this.isEditable) return;
    const index = Number(target.dataset.index);
    const sig = signatureOf(this.item);
    const entry = sig.features[index];
    const def = featureDef(entry?.id);
    if (!def?.choose) return;
    const choice = await this.#askChoice(def, entry.ranks, sig);
    if (choice === null) return;
    const features = sig.features.map((each, at) => (at === index) ? { ...each, choice } : each);
    return this.item.update(this.#withFeatures(features));
  }

  /** Re-sync: the Effects rebuilt from the features alone - what was changed or added is lost. */
  static async _onResyncTechnique() {
    if (!this.isEditable) return;
    const sure = await foundry.applications.api.DialogV2.confirm({
      classes: ["dbu-dialog"],
      window: { title: "Re-sync Effects" },
      content: "<p>All of this Technique's Effects are replaced by what its Advantages and "
        + "Disadvantages write. Anything you changed or added is lost.</p>",
      rejectClose: false
    });
    if (!sure) return;
    return this.item.update({ "system.script": composeTechniqueEffects(signatureOf(this.item), "") });
  }

  /** What a feature may choose, as [value, label] pairs. */
  #choiceOptions(def, ranks, sig) {
    const list = [].concat(def.choices ?? []).map(String);
    const byTrait = traits => traits.map(trait => [trait.id, trait.name]);
    switch (def.choose) {
      case "shape": case "skill": case "roll":
        return list.map(value => [value, choiceLabel(def, value)]);
      case "condition":
        return list.map(value => [value, getTrait(value)?.name ?? value]);
      case "feature":
        return list.filter(id => sig.features.some(entry => entry.id === id))
          .map(id => [id, featureDef(id)?.name ?? id]);
      case "environment":
        return [["high", "High Environment (any)"],
          ...byTrait(traitsOfKind("battlefields").filter(t => (t.environment === true) && (t.id !== "standard-environment")))];
      case "state":
        return byTrait(traitsOfKind("states"));
      case "weather":
        return byTrait(traitsOfKind("battlefields").filter(t => t.weather === true));
      case "profile":
        return Object.entries(PROFILES).map(([id, profile]) => [id, profile.label]);
      case "maneuver":
        return Array.from(this.item.actor?.items ?? [])
          .filter(item => (item.type === "maneuver") && item.system.special && (item.system.actionCost === 1))
          .map(item => [item.system.maneuverId || item.id, item.name]);
      case "weapon":
        if (ranks >= 2) {
          return Array.from(this.item.actor?.items ?? [])
            .filter(item => (item.system?.crafted?.kind === "weapon"))
            .map(item => [item.id, item.name]);
        }
        return traitsOfKind("crafting", "weapon-categories")
          .filter(t => !sig.foundation || (t.weaponType === sig.foundation))
          .map(t => [t.id, t.name]);
      default:
        return [];
    }
  }

  /** Ask for a feature's choice. Null when it was cancelled. */
  async #askChoice(def, ranks, sig) {
    if (def.choose === "text") {
      const typed = await foundry.applications.api.DialogV2.prompt({
        classes: ["dbu-dialog"],
        window: { title: def.name },
        content: `<p>${Handlebars.escapeExpression(def.summary ?? "")}</p>
          <input type="text" name="choice" autofocus/>`,
        ok: { label: "Choose", callback: (e, button) => button.form.elements.choice.value },
        rejectClose: false
      });
      return (typeof typed === "string") ? typed.trim() : null;
    }
    const options = this.#choiceOptions(def, ranks, sig);
    if (!options.length) {
      ui.notifications.warn(`${def.name}: nothing to choose from yet.`);
      return "";
    }
    const chosen = await foundry.applications.api.DialogV2.wait({
      classes: ["dbu-dialog"],
      window: { title: def.name },
      content: "",
      buttons: [
        ...options.map(([value, label]) => ({ action: value, label })),
        { action: "cancel", label: "Cancel" }
      ],
      rejectClose: false
    });
    return options.some(([value]) => value === chosen) ? chosen : null;
  }

  /**
   * Keep the build consistent as it is changed on Sig Creation: a Profile that is not of the
   * Foundation chosen is cleared, a Super Profile only stays on a Dramatic Finisher, and a
   * Technique that has a Profile is an Attacking Maneuver tagged `signature`.
   */
  async _processSubmitData(event, form, submitData, options) {
    const sent = foundry.utils.getProperty(submitData, "system.signature");
    if (sent && this.#technique) {
      const now = { ...signatureOf(this.item), ...sent };
      if (now.profile && now.foundation && !(PROFILES[now.profile]?.foundations ?? []).includes(now.foundation)) {
        foundry.utils.setProperty(submitData, "system.signature.profile", "");
      }
      if (now.level !== "dramatic") {
        foundry.utils.setProperty(submitData, "system.signature.superProfile", "");
        foundry.utils.setProperty(submitData, "system.signature.secondProfile", "");
      }
      if (now.superProfile !== "multi-profile") {
        foundry.utils.setProperty(submitData, "system.signature.secondProfile", "");
      }
      foundry.utils.setProperty(submitData, "system.attacking", true);
    }
    return super._processSubmitData(event, form, submitData, options);
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
