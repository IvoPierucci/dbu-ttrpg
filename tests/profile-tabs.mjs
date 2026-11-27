/**
 * The attack Profile picker as the user designed it (2026-11-15): the Ki Wager on top, Wager Life Points beside it only while a
 * Profile allowing it is picked; a tab per Foundation - the Multi-Foundation Profiles in each, named and made with its Foundation
 * ("Energy Simple"), then its own; the Foundation taken from the tab, never asked after.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.argv[2];
const MAN = fs.readFileSync(path.join(ROOT, "module", "maneuvers.mjs"), "utf8").replace(/\r\n/g, "\n");
let failed = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`);
};
const fn = name => {
  const at = MAN.indexOf(`function ${name}(`);
  if (at < 0) throw new Error(`no function ${name}`);
  return MAN.slice(at, MAN.indexOf("\n}\n", at) + 3);
};

globalThis.Handlebars = { escapeExpression: text => String(text ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;") };
// A row as profileOption draws it, reduced to what the tabs hand it.
const profileOption = (profile, maneuver, actor, state, limits, { value, label }) => {
  const selected = state.first && !profile.spent;
  if (selected) state.onFirst();
  return `<row value="${value}" label="${label}"${selected ? " checked" : ""}/>`;
};
const { profileTabs, openProfileTab, profileTabsHtml, PROFILE_TABS } = new Function("profileOption", "favoredElement", "FOUNDATION_NOTES",
  `const PROFILE_TABS = new Map();\n${["profileTabs", "openProfileTab", "profileTabsHtml"].map(fn).join("\n")}
   return { profileTabs, openProfileTab, profileTabsHtml, PROFILE_TABS };`)(profileOption, (actor, id) => id === "elementalDark",
  { physical: "Physical note", energy: "Energy note", magic: "Magic note" });

const FOUNDATIONS = { physical: { label: "Physical" }, energy: { label: "Energy" }, magic: { label: "Magic" } };
const P = (id, label, foundations, extra = {}) => ({ id, label, foundations, ...extra });
const pool = [P("simple", "Simple", ["physical", "energy", "magic"]), P("combination", "Combination", ["physical", "energy", "magic"]),
  P("blitz", "Blitz", ["physical"]), P("beam", "Beam", ["energy"]), P("elementalDark", "Elemental (Dark)", ["magic"]),
  P("elementalFire", "Elemental (Fire)", ["magic"])];
const tabs = profileTabs({}, FOUNDATIONS, {}, pool, {});
check("a tab per Foundation: the Multi-Foundation Profiles in each, then its own, counted",
  tabs.map(tab => [tab.key, tab.multi.map(p => p.id), tab.own.map(p => p.id), tab.count]),
  [["physical", ["simple", "combination"], ["blitz"], 3], ["energy", ["simple", "combination"], ["beam"], 3],
   ["magic", ["simple", "combination"], ["elementalDark", "elementalFire"], 4]]);
check("one a Maneuver pins to a Foundation, in that tab alone",
  profileTabs({ profileFoundation: { combination: "physical" } }, FOUNDATIONS, {}, pool, {}).map(tab => tab.multi.map(p => p.id)),
  [["simple", "combination"], ["simple"], ["simple"]]);
const shut = profileTabs({}, FOUNDATIONS, {}, pool, { magic: "Magic Score below 3", energy: "Force below 3" });
check("a shut Foundation's tab: its reason, its Favored Elements alone - none, nothing",
  shut.map(tab => [tab.key, tab.reason, tab.count, tab.own.map(p => p.id)]),
  [["physical", "", 3, ["blitz"]], ["energy", "Force below 3", 0, []], ["magic", "Magic Score below 3", 1, ["elementalDark"]]]);

const html = profileTabsHtml(tabs, "energy", {}, {}, {});
check("drawn: the open tab active, its pane shown, the others hidden; each tab its count",
  [/data-profile-tab="energy"[^>]*>Energy<b>3<\/b>/.test(html), /class="dbu-profile-tab active"[^>]*data-profile-tab="energy"/.test(html),
   /data-profile-pane="energy">/.test(html), /data-profile-pane="physical" hidden>/.test(html)], [true, true, true, true]);
check("the Multi-Foundation rows named and valued with the tab's Foundation; its own by their names; the first in the open tab picked",
  [html.includes('<row value="energy|simple" label="Energy Simple" checked/>'), html.includes('<row value="physical|simple" label="Physical Simple"/>'),
   html.includes('<row value="energy|beam" label="Beam"/>'), (html.match(/ checked\/>/g) ?? []).length,
   html.includes("Any Foundation &middot; made as Energy")], [true, true, true, 1, true]);
const shutHtml = profileTabsHtml(shut, "physical", {}, {}, {});
check("a shut tab greyed with its reason; one with nothing to offer disabled",
  [/class="dbu-profile-tab dbu-profile-tab-shut"\s*data-profile-tab="energy" data-tooltip="Force below 3" disabled>/.test(shutHtml),
   /class="dbu-profile-tab dbu-profile-tab-shut"\s*data-profile-tab="magic" data-tooltip="Magic Score below 3">/.test(shutHtml)], [true, true]);

PROFILE_TABS.set("Actor.goku", "magic");
check("the tab that opens: the one last chosen from, while it offers something; else the first that does",
  [openProfileTab({ uuid: "Actor.goku" }, tabs), openProfileTab({ uuid: "Actor.goku" }, shut.map(tab => (tab.key === "magic") ? { ...tab, count: 0 } : tab)),
   openProfileTab({ uuid: "Actor.vegeta" }, tabs)], ["magic", "physical", "physical"]);

// Wired in the picker and the declaration.
const pick = /async function pickProfile\([^)]*\) \{[\s\S]*?\n\}/.exec(MAN)?.[0] ?? "";
const declare = /export async function declareAttack\([^)]*\) \{[\s\S]*?\n\}/.exec(MAN)?.[0] ?? "";
check("the Ki Wager on top, Wager Life Points beside it, shown by the Profile picked; the tabs bound; the Foundation answered by the tab",
  [pick.includes("content: `${attackPoolsHtml(maneuver, actor)}${wager}${body}`,"), pick.includes('<label class="dbu-wager-life" data-wager-life${second?.wagerFromLife ? " data-always" : ""}'),
   pick.includes("render: (event, dialog) => { bindProfileTabs(dialog.element); bindAttackPools(dialog.element); },"),
   pick.includes("String(dialog.element.querySelector('input[name=\"profile\"]:checked')?.value ?? \"\").split(\"|\")"),
   pick.includes("if (foundation) PROFILE_TABS.set(actor?.uuid ?? \"\", foundation);"),
   declare.includes("const foundation = (tabFoundation && available.includes(tabFoundation))")], [true, true, true, true, true, true]);
check("a row says whether its Profile allows a Life wager, for the box beside the Ki Wager",
  MAN.includes('<input type="radio" name="profile" value="${Handlebars.escapeExpression(value)}" data-cost="${cost}"${profile.wagerFromLife ? " data-life" : ""}'), true);

// The tabs at work, on a small DOM: a tab shows its pane and picks its first row where the picked one is not in it; the Life box follows.
{
  const el = (attrs = {}) => ({ dataset: { ...(attrs.dataset ?? {}) }, hidden: Boolean(attrs.hidden), checked: Boolean(attrs.checked),
    disabled: Boolean(attrs.disabled), name: attrs.name ?? "", classList: { set: new Set(attrs.cls ?? []), toggle(c, on) { on ? this.set.add(c) : this.set.delete(c); } },
    listeners: {}, addEventListener(type, f) { this.listeners[type] = f; }, children: attrs.children ?? [],
    querySelector(sel) { return this.querySelectorAll(sel)[0] ?? null; },
    querySelectorAll(sel) { return (attrs.find ?? (() => []))(sel, this); } });
  const radio = (value, life = false, pane) => { const r = el({ name: "profile", dataset: life ? { life: "" } : {} }); r.value = value; r.pane = pane; return r; };
  const radios = [radio("physical|simple", false, "physical"), radio("physical|blitz", false, "physical"),
    radio("magic|simple", false, "magic"), radio("magic|elementalDark", true, "magic")];
  // One group, as a browser keeps radios of one name: ticking one unticks the rest.
  for (const r of radios) {
    let on = false;
    Object.defineProperty(r, "checked", { get: () => on, set: value => { if (value) for (const o of radios) if (o !== r) o.uncheck(); on = Boolean(value); } });
    r.uncheck = () => { on = false; };
  }
  radios[0].checked = true;
  const panes = ["physical", "magic"].map(key => el({ dataset: { profilePane: key }, hidden: key !== "physical",
    find: (sel, self) => radios.filter(r => (r.pane === key) && (sel.includes(":checked") ? r.checked : sel.includes(":not(:disabled)") ? !r.disabled : true)) }));
  const tabButtons = ["physical", "magic"].map(key => el({ dataset: { profileTab: key }, cls: (key === "physical") ? ["active"] : [] }));
  const lifeBox = el(); const box = el(); lifeBox.querySelector = () => box;
  const root = el({ find: sel => {
    if (sel === "[data-wager-life]") return [lifeBox];
    if (sel === "[data-profile-tab]") return tabButtons;
    if (sel === "[data-profile-pane]") return panes;
    const pane = /\[data-profile-pane="(\w+)"\]/.exec(sel); if (pane) return panes.filter(p => p.dataset.profilePane === pane[1]);
    if (sel === 'input[name="profile"]:checked') return radios.filter(r => r.checked);
    return [];
  } });
  new Function(`${fn("bindProfileTabs")}; return bindProfileTabs;`)()(root);
  const before = lifeBox.hidden;
  tabButtons[1].listeners.click({ preventDefault() {} });
  const afterTab = [panes.map(p => p.hidden), radios.filter(r => r.checked).map(r => r.value), tabButtons.map(t => t.classList.set.has("active"))];
  radios.forEach(r => { r.checked = r.value === "magic|elementalDark"; });
  root.listeners.change({ target: { name: "profile" } });
  const withDark = lifeBox.hidden;
  box.checked = true;
  radios.forEach(r => { r.checked = r.value === "magic|simple"; });
  root.listeners.change({ target: { name: "profile" } });
  check("at work: Life box hidden at first; a tab shows its pane and picks its first row; Elemental (Dark) shows the box; another hides and unticks it",
    [before, afterTab, withDark, [lifeBox.hidden, box.checked]],
    [true, [[true, false], ["physical|simple", "magic|simple"].filter(v => v === "magic|simple"), [false, true]], false, [true, false]]);
}

// The pools on top (the user's): now and after, paid as the system pays; a number short red, nothing said.
{
  const make = new Function("staminaForKi", "asksStamina", "maneuverKiCost", `const pilotedBy = () => null;\n${fn("attackPoolsHtml")}\n${fn("bindAttackPools")}
    return { attackPoolsHtml, bindAttackPools };`);
  const run = ({ system, stamina = 0, ask = false, cost = 9, wager = 0, ticks = {}, lifeShown = false, god = false }) => {
    const { attackPoolsHtml, bindAttackPools } = make(() => stamina, () => ask && stamina > 0, () => 0);
    const html = attackPoolsHtml({ profile: "any", godManeuver: god }, { system });
    const dataset = {};
    for (const [, key, value] of html.matchAll(/data-([a-z-]+)="([^"]*)"/g)) dataset[key.replace(/-([a-z])/g, (m, c) => c.toUpperCase())] = value;
    const box = { dataset, innerHTML: "" };
    const input = (name, checked, hidden = false) => ({ name, checked, closest: () => (hidden ? {} : null) });
    const inputs = { wagerFromLife: input("wagerFromLife", Boolean(ticks.life), !lifeShown), wagerFromDivine: input("wagerFromDivine", Boolean(ticks.divine)),
      payStamina: input("payStamina", Boolean(ticks.stamina)) };
    const root = { addEventListener() {}, querySelector: sel => {
      if (sel === "[data-attack-pools]") return box;
      if (sel === 'input[name="profile"]:checked') return { dataset: { cost: String(cost) } };
      if (sel === 'input[name="kiWager"]') return { value: String(wager) };
      const name = /name="(\w+)"/.exec(sel)?.[1];
      return inputs[name] ?? null;
    } };
    bindAttackPools(root);
    return [...box.innerHTML.matchAll(/dbu-attack-pool (\w+)( short)?"><em>[^<]+<\/em>(-?\d+)<span[^>]*>&rarr;<\/span><b>(-?\d+)<\/b>/g)]
      .map(m => [m[1], Number(m[3]), Number(m[4]), Boolean(m[2])]);
  };
  const base = { ki: { value: 52, max: 70 }, capacity: { max: 14, spent: 4 }, life: { value: 84, max: 96 }, divineKi: {}, narrativeStamina: {} };
  check("Ki and Capacity: the cost and the wager off both; Capacity short, its number red",
    run({ system: base, cost: 9, wager: 3 }), [["ki", 52, 40, false], ["capacity", 10, -2, true]]);
  check("God Ki, Spend Divine Ki on: the cost in Divine Ki, the Divine wager too - each at half its Capacity, rounded up; Ki untouched",
    run({ system: { ...base, divineKi: { active: true, use: true, value: 40, max: 79 } }, cost: 9, wager: 5, ticks: { divine: true } }),
    [["ki", 52, 52, false], ["capacity", 10, 2, false], ["divine", 40, 26, false]]);
  check("Divine Ki short of the whole cost: the cost in Ki, all or none",
    run({ system: { ...base, divineKi: { active: true, use: true, value: 5, max: 79 } }, cost: 9 }),
    [["ki", 52, 43, false], ["capacity", 10, 1, false], ["divine", 5, 5, false]]);
  check("an Elite's Stamina on Auto: first for what Ki pays, off the Capacity too; its Capacity ignored, never red",
    run({ system: { ...base, capacity: { max: 14, spent: 20, ignored: true }, narrativeStamina: { max: 36 } }, stamina: 36, cost: 9, wager: 3 }),
    [["ki", 52, 52, false], ["capacity", -6, -6, false], ["stamina", 36, 24, false]]);
  check("on Ask: only ticked",
    run({ system: { ...base, narrativeStamina: { max: 36 } }, stamina: 36, ask: true, cost: 9 }).map(row => row.slice(0, 3)),
    [["ki", 52, 43], ["capacity", 10, 1], ["stamina", 36, 36]]);
  check("Wager Life Points ticked and shown: the wager off Life, still off the Capacity; hidden, as if not ticked",
    [run({ system: base, cost: 9, wager: 5, ticks: { life: true }, lifeShown: true }), run({ system: base, cost: 9, wager: 5, ticks: { life: true } })],
    [[["ki", 52, 43, false], ["capacity", 10, -4, true], ["life", 84, 79, false]], [["ki", 52, 38, false], ["capacity", 10, -4, true]]]);
  check("a God Maneuver: its cost always in Divine Ki",
    run({ system: { ...base, divineKi: { active: true, use: false, value: 40, max: 79 } }, cost: 10, god: true }),
    [["ki", 52, 52, false], ["capacity", 10, 5, false], ["divine", 40, 30, false]]);
  check("on the window, above the Ki Wager; every row its cost",
    [MAN.includes("content: `${attackPoolsHtml(maneuver, actor)}${wager}${body}`,"),
     MAN.includes("render: (event, dialog) => { bindProfileTabs(dialog.element); bindAttackPools(dialog.element); },"),
     MAN.includes('value="${Handlebars.escapeExpression(value)}" data-cost="${cost}"')], [true, true, true]);
}

console.log(failed ? `${failed} failing` : "all passing");
process.exit(failed ? 1 : 0);
