/**
 * The window of a race's own Racial Traits (the user's, 2026-11-27): choosing a race gives its fixed Traits - Primary, Secondary and
 * Subrace, as race-traits.mjs plans them - and their Options and choices are asked here, a page a Trait (racial.mjs traitPage), with
 * Last and Next below (Done on the last page) and the window's close at the top right. Only those: the Traits picked afterwards (the
 * Majins' 4, a Minion's 2), Factor Traits, and Add Racial Trait ask in their own windows as they always have.
 *
 * The pages are known from the Traits' files, so the window counts them ("2 of 5"); an answer may change what follows (Enhanced
 * Organism in place of Functional Purpose's page puts a page for which Alternate Upbringing Factor Trait), and the pages are worked out
 * again as it does. Closed before the end, what was answered is kept and the rest left unanswered (Set Racial Options).
 */

import { NOT_YET } from "./racial.mjs";

let RaceWindowApp = null;

/** The window - its class made when first wanted (Foundry's API is not there as this module loads headless). */
function raceWindowApp() {
  RaceWindowApp ??= class extends foundry.applications.api.ApplicationV2 {
    static DEFAULT_OPTIONS = {
      classes: ["dbu-dialog", "dbu-choice-wizard"],
      window: { title: "Racial Traits", resizable: true },
      position: { width: 500, height: "auto" }
    };

    constructor(onClose, options = {}) {
      super(options);
      this.onClosed = onClose;
    }

    async _renderHTML() {
      const page = document.createElement("div");
      page.className = "dbu-wizard";
      return page;
    }

    _replaceHTML(result, content) {
      if (!content.querySelector(".dbu-wizard")) content.replaceChildren(result);
    }

    async close(options = {}) {
      this.onClosed?.();
      this.onClosed = null;
      return super.close(options);
    }
  };
  return RaceWindowApp;
}

/**
 * Ask a run of pages in one window. `pagesFor(answers)` gives the pages for the answers so far - each `{key, title, build}`, where
 * `build()` resolves to `{html, wire(root), read(root, pressed)}` (`read` NOT_YET while it cannot be answered yet). Resolves to the
 * answers given, a Map by page key, when Done is pressed or the window is closed; an empty Map at once where there are no pages.
 */
export function askPages(title, pagesFor) {
  if (!pagesFor(new Map()).length) return Promise.resolve(new Map());
  return new Promise(resolve => {
    const answers = new Map();
    // What was ticked on each page, to put back when it is shown again.
    const snapshots = new Map();
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      resolve(answers);
    };
    const app = new (raceWindowApp())(finish, { window: { title } });
    const escape = Handlebars.escapeExpression;
    let shown = 0;
    const show = async at => {
      const pages = pagesFor(answers);
      if (!pages.length) return close();
      shown = Math.max(0, Math.min(at, pages.length - 1));
      const page = pages[shown];
      const part = await page.build();
      if (finished) return;
      const root = app.element?.querySelector(".window-content");
      if (!root) return;
      root.innerHTML = `<div class="dbu-wizard">
        <header class="dbu-wizard-head"><span class="dbu-wizard-step">${shown + 1} of ${pages.length}</span><h3>${escape(page.title)}</h3></header>
        <div class="dbu-wizard-body">${part?.html ?? ""}</div>
        <footer class="dbu-wizard-nav">
          <button type="button" data-page="last" ${shown ? "" : "disabled"}><i class="fa-solid fa-chevron-left"></i> Last</button>
          <button type="button" data-page="next">Next <i class="fa-solid fa-chevron-right"></i></button>
        </footer></div>`;
      const body = root.querySelector(".dbu-wizard-body");
      part?.wire?.(body);
      restore(body, snapshots.get(page.key));
      const next = root.querySelector('[data-page="next"]');
      // Done where nothing follows this page with its answer as it stands - found again as it changes.
      const label = () => {
        const value = part?.read?.(body, false);
        const tentative = new Map(answers);
        if (value !== NOT_YET) tentative.set(page.key, value);
        const count = pagesFor(tentative).length;
        const last = count <= (shown + 1);
        root.querySelector(".dbu-wizard-step").textContent = `${shown + 1} of ${Math.max(count, shown + 1)}`;
        next.dataset.done = last ? "1" : "0";
        next.innerHTML = last ? `Done <i class="fa-solid fa-check"></i>` : `Next <i class="fa-solid fa-chevron-right"></i>`;
      };
      body.addEventListener("change", label);
      label();
      next.addEventListener("click", () => {
        const value = part?.read?.(body, true);
        if (value === NOT_YET) {
          const hint = body.querySelector(".dbu-respond-hint.dbu-wizard-needs") ?? body.querySelector(".dbu-respond-hint");
          ui.notifications.warn(`${page.title}: ${hint?.textContent?.trim() || "not answered yet."}`);
          return;
        }
        answers.set(page.key, value);
        snapshots.set(page.key, snapshot(body));
        if (pagesFor(answers).length <= (shown + 1)) return close();
        show(shown + 1);
      });
      root.querySelector('[data-page="last"]')?.addEventListener("click", () => {
        snapshots.set(page.key, snapshot(body));
        show(shown - 1);
      });
      app.setPosition({ height: "auto" });
    };
    const close = () => {
      finish();
      app.close();
    };
    app.render({ force: true }).then(() => show(0));
  });
}

/** What was ticked, chosen and written on a page, in order. */
function snapshot(body) {
  return Array.from(body.querySelectorAll("input, select, textarea")).map(field =>
    ((field.type === "checkbox") || (field.type === "radio")) ? field.checked : field.value);
}

/** Put a page back as it was - each field told it changed, so what follows it (a later choice's list) follows before the next. */
function restore(body, values) {
  if (!values) return;
  Array.from(body.querySelectorAll("input, select, textarea")).forEach((field, at) => {
    if (at >= values.length) return;
    if ((field.type === "checkbox") || (field.type === "radio")) field.checked = Boolean(values[at]);
    else field.value = values[at];
    field.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
