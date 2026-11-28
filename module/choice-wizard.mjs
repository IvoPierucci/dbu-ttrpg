/**
 * One window for many questions (the user's, 2026-11-27): choosing a race gives several Racial Traits at once, and each used to ask its
 * Options and choices in a window of its own, one after another and mixed. Inside `withChoiceWizard`, every DialogV2.wait asked on this
 * client is drawn as a page of a single window instead - its title the question's, its content and its own buttons as they were - with
 * Last and Next below and the window's close at the top right.
 *
 * - **Next** answers as the question's default button would - **Done** where nothing is asked after it in the `rewindable` work (its
 *   end found by running that work again with this answer; the work makes nothing).
 * - **Last** goes back a question. The questions asked in `rewindable` work are asked again from the start with the answers already given
 *   (nothing is made there, so nothing is undone), the earlier question shown with what was ticked in it; Last is off once that work is
 *   done and things are being made with the answers.
 * - **Close** answers the question shown, and every one after it, as closing its own window would: nothing (null).
 *
 * Nothing here names a race, a Trait or a question: any code that asks through DialogV2.wait is drawn this way while a wizard runs.
 */

const REWIND = Symbol("rewind");
const MORE = Symbol("more");
/**
 * What a question's default button answers while it cannot be answered yet - a Multi-Option's "choose two" with one ticked: Next pressed
 * stays on that question, its hint ("Choose 2.") said again, rather than moving on (the user's, 2026-11-27). Symbol.for, so a module
 * asking need not import this one; outside a wizard, a dialog closes with it and its asker reads it as not answered, as before.
 */
export const NOT_YET = Symbol.for("dbu-ttrpg.notYet");

/** The window: a page drawn by the session - its class made when first wanted (Foundry's API is not there as this module loads headless). */
let ChoiceWizardApp = null;
function wizardApp() {
  ChoiceWizardApp ??= class extends foundry.applications.api.ApplicationV2 {
    static DEFAULT_OPTIONS = {
      classes: ["dbu-dialog", "dbu-choice-wizard"],
      window: { title: "Choices", resizable: true },
      position: { width: 480, height: "auto" }
    };

    constructor(session, options = {}) {
      super(options);
      this.session = session;
    }

    async _renderHTML() {
      const page = document.createElement("div");
      page.className = "dbu-wizard";
      return page;
    }

    _replaceHTML(result, content) {
      if (!content.querySelector(".dbu-wizard")) content.replaceChildren(result);
    }

    /** The window's own close: the question shown, and all after it, answered with nothing. */
    async close(options = {}) {
      if (!options.fromSession) this.session.closeAll();
      return super.close(options);
    }
  };
  return ChoiceWizardApp;
}

class ChoiceSession {
  constructor(title) {
    this.title = title;
    this.answers = [];
    // What was ticked or written on each page, to put back when it is shown again - kept with what the page was, so a page that differs
    // after a different earlier answer starts fresh.
    this.snapshots = [];
    this.cursor = 0;
    this.rewindable = false;
    this.rewindStart = 0;
    this.rewindFn = null;
    // While finding whether a question is the last: the answers to run the work again with.
    this.probe = null;
    this.closed = false;
    this.app = null;
    this.pending = null;
  }

  /** Close: the question waiting answered with nothing, and every one after it. */
  closeAll() {
    this.closed = true;
    const pending = this.pending;
    this.pending = null;
    pending?.resolve(pending.config.rejectClose ? undefined : null);
  }

  async ask(config = {}) {
    if (this.probe) {
      if (this.probe.cursor < this.probe.answers.length) return this.probe.answers[this.probe.cursor++];
      throw MORE;
    }
    if (this.closed) return null;
    const index = this.cursor++;
    if (index < this.answers.length) return this.answers[index];
    return new Promise((resolve, reject) => {
      this.pending = { resolve, reject, index, config };
      this.draw(config, index);
    });
  }

  /** Whether the question `index`, answered `value`, is the last the `rewindable` work asks. */
  async isLast(index, value) {
    if (!this.rewindable || !this.rewindFn) return false;
    this.probe = { answers: [...this.answers.slice(0, index), value], cursor: this.rewindStart };
    try {
      await this.rewindFn();
      return true;
    }
    catch (error) {
      return false;
    }
    finally {
      this.probe = null;
    }
  }

  async draw(config, index) {
    if (!this.app) {
      this.app = new (wizardApp())(this, { window: { title: this.title } });
      await this.app.render({ force: true });
    }
    const root = this.app.element?.querySelector(".window-content");
    if (!root) return;
    const escape = Handlebars.escapeExpression;
    const buttons = Array.from(config.buttons ?? []);
    const main = buttons.find(button => button.default) ?? null;
    // The question's own other answers - "None", "Later, by hand" - beside it; a bare Cancel is the window's close.
    const others = buttons.filter(button => (button !== main) && !((button.action === "cancel") && (button.label === "Cancel")));
    const title = String(config.window?.title ?? "");
    const key = `${title}\n${typeof config.content === "string" ? config.content : ""}`;
    root.innerHTML = `<div class="dbu-wizard">
      <header class="dbu-wizard-head"><span class="dbu-wizard-step">Question ${index + 1}</span><h3>${escape(title)}</h3></header>
      <div class="dbu-wizard-body"></div>
      ${others.length ? `<div class="dbu-wizard-others">${others.map(button =>
        `<button type="button" data-action="${escape(button.action)}">${escape(button.label ?? button.action)}</button>`).join("")}</div>` : ""}
      <footer class="dbu-wizard-nav">
        <button type="button" data-wizard="last" ${(this.rewindable && (index > this.rewindStart)) ? "" : "disabled"}
          data-tooltip="${this.rewindable ? "Back a question" : "What was answered before has been given"}">
          <i class="fa-solid fa-chevron-left"></i> Last</button>
        ${main ? `<button type="button" data-wizard="next" data-action="${escape(main.action)}">Next <i class="fa-solid fa-chevron-right"></i></button>` : ""}
      </footer></div>`;
    const body = root.querySelector(".dbu-wizard-body");
    if (config.content instanceof HTMLElement) body.append(config.content);
    else body.innerHTML = String(config.content ?? "");
    const dialog = { element: root, close: () => {} };
    config.render?.(new Event("render"), dialog);
    const saved = this.snapshots[index];
    if (saved && (saved.key === key)) restore(body, saved.values);
    const answer = async (button, element, event) => {
      if (!this.pending || (this.pending.index !== index)) return;
      const value = button.callback ? await button.callback(event, element, dialog) : button.action;
      if (value === NOT_YET) {
        const hint = body.querySelector(".dbu-respond-hint");
        hint?.classList.add("dbu-wizard-needs");
        ui.notifications.warn(`${title}: ${hint?.textContent?.trim() || "not answered yet."}`);
        return;
      }
      this.snapshots[index] = { key, values: snapshot(body) };
      this.answers[index] = value;
      const pending = this.pending;
      this.pending = null;
      pending.resolve(value);
    };
    const next = root.querySelector('[data-wizard="next"]');
    next?.addEventListener("click", event => {
      const done = next.dataset.done === "1";
      answer(main, event.currentTarget, event).then(() => {
        // Done: the window closed at once (the user's) while what was answered is given - opened again only if making it asks more.
        if (done && !this.pending && (root.querySelector(".dbu-wizard-body") === body)) this.hide();
      });
    });
    // Next or Done: Done where nothing would be asked after this answer (isLast) - found again as the answer changes.
    let probing = 0;
    const label = async () => {
      if (!next || !main) return;
      const ticket = ++probing;
      next.disabled = true;
      let value = null;
      try { value = main.callback ? await main.callback(new Event("probe"), next, dialog) : main.action; }
      catch (error) { value = null; }
      if (value === NOT_YET) {
        if (ticket !== probing) return;
        next.disabled = false;
        next.dataset.done = "0";
        next.innerHTML = `Next <i class="fa-solid fa-chevron-right"></i>`;
        return;
      }
      const last = await this.isLast(index, value);
      if (ticket !== probing) return;
      next.disabled = false;
      next.dataset.done = last ? "1" : "0";
      next.innerHTML = last ? `Done <i class="fa-solid fa-check"></i>` : `Next <i class="fa-solid fa-chevron-right"></i>`;
    };
    body.addEventListener("change", label);
    body.addEventListener("input", label);
    for (const element of root.querySelectorAll(".dbu-wizard-others [data-action]")) {
      const button = others.find(each => each.action === element.dataset.action);
      element.addEventListener("click", event => answer(button, element, event));
    }
    root.querySelector('[data-wizard="last"]')?.addEventListener("click", () => {
      if (!this.rewindable || !this.pending || (index <= this.rewindStart)) return;
      this.snapshots[index] = { key, values: snapshot(body) };
      this.answers.length = index - 1;
      const pending = this.pending;
      this.pending = null;
      pending.reject(REWIND);
    });
    // Enter answers as Next, as a dialog's default button - not in a text box of several lines.
    body.addEventListener("keydown", event => {
      if ((event.key !== "Enter") || (event.target?.tagName === "TEXTAREA") || !main) return;
      event.preventDefault();
      root.querySelector('[data-wizard="next"]')?.click();
    });
    (body.querySelector("[autofocus]") ?? body.querySelector("input, select, textarea") ?? root.querySelector('[data-wizard="next"]'))?.focus?.();
    this.app.setPosition({ height: "auto" });
    label();
  }

  /** The window put away - a later question opens a new one. */
  hide() {
    const app = this.app;
    this.app = null;
    app?.close({ fromSession: true });
  }

  async finish() {
    this.closed = true;
    if (this.app) await this.app.close({ fromSession: true });
    this.app = null;
  }
}

/** What was ticked, chosen and written on a page, in order. */
function snapshot(body) {
  return Array.from(body.querySelectorAll("input, select, textarea")).map(field =>
    ((field.type === "checkbox") || (field.type === "radio")) ? field.checked : field.value);
}

function restore(body, values) {
  Array.from(body.querySelectorAll("input, select, textarea")).forEach((field, at) => {
    if (at >= values.length) return;
    if ((field.type === "checkbox") || (field.type === "radio")) field.checked = Boolean(values[at]);
    else field.value = values[at];
  });
}

let active = null;

/**
 * Run `work(wizard)` with every DialogV2.wait asked on this client drawn as a page of one window titled `title`. In it,
 * `wizard.rewindable(fn)` runs `fn` so that Last may go back into it: `fn` is run again from its start with the answers given, so it must
 * make nothing. The window shows only if something is asked, and closes when `work` is done.
 */
export async function withChoiceWizard(title, work) {
  if (active) return work(active.handle);
  const DialogV2 = foundry.applications.api.DialogV2;
  const session = new ChoiceSession(title);
  const original = DialogV2.wait;
  const handle = {
    rewindable: async fn => {
      session.rewindable = true;
      session.rewindFn = fn;
      const start = session.rewindStart = session.cursor;
      try {
        for (;;) {
          session.cursor = start;
          try {
            return await fn();
          }
          catch (error) {
            if (error !== REWIND) throw error;
          }
        }
      }
      finally {
        session.rewindable = false;
        session.rewindFn = null;
      }
    },
    get closed() { return session.closed; }
  };
  active = { session, handle };
  DialogV2.wait = config => session.ask(config);
  try {
    return await work(handle);
  }
  finally {
    DialogV2.wait = original;
    active = null;
    await session.finish();
  }
}
