/**
 * The search-as-you-type list the Adv & Disadv and Advancements/Restrictions tabs use, and the Add Unique Ability
 * window: an input over a list of `[data-feature-option]` entries (each with `data-name`, and `data-group` naming
 * a `[data-feature-group]` heading), filtered by what the name starts with. Arrow keys move, Enter picks - and,
 * with one picked, submits.
 *
 * `alwaysOpen`: the list stays shown under the input - a window of its own, where there is nothing for it to open
 * over.
 */

import { namePrefixMatches } from "./gear.mjs";

export function wireNameSearch(input, list, { onSubmit = null, alwaysOpen = false } = {}) {
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
  const close = () => { if (!alwaysOpen) list.hidden = true; };
  const pick = option => {
    input.value = option.dataset.name;
    input.dataset.picked = option.dataset.featureOption;
    light(option);
    close();
  };
  input.addEventListener("focus", open);
  input.addEventListener("click", () => list.hidden && open());
  input.addEventListener("input", () => { delete input.dataset.picked; open(); });
  input.addEventListener("change", event => event.stopPropagation());
  input.addEventListener("blur", close);
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
      event.stopPropagation();
      if (alwaysOpen) {
        // Nothing to close first: Enter on the one lit is picking it and adding it at once.
        if (lit()) pick(lit());
        if (input.dataset.picked) onSubmit?.(event);
      } else if (!list.hidden && lit()) pick(lit());
      else if (input.dataset.picked) onSubmit?.(event);
    } else if ((event.key === "Escape") && !list.hidden && !alwaysOpen) {
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
  list.addEventListener("dblclick", event => {
    const option = event.target.closest("[data-feature-option]");
    if (!option) return;
    pick(option);
    onSubmit?.(event);
  });
  if (alwaysOpen) open();
}

/** The option picked in the search - or, with none picked, the first whose name starts with what is typed. */
export function pickedName(input, list) {
  if (!input) return "";
  if (input.dataset.picked) return input.dataset.picked;
  if (!input.value.trim()) return "";
  return [...(list?.querySelectorAll("[data-feature-option]") ?? [])]
    .find(option => namePrefixMatches(option.dataset.name, input.value))?.dataset.featureOption ?? "";
}
