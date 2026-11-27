// The Combat tab as the user laid it out (2026-10-30), rendered with Foundry's own Handlebars: the Turn State button and
// its chips, the three lists and what "temporary" means in them, the Manage windows, Dice / Aptitudes / Capacity, the
// Steadfast boxes and the Combat Rolls.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const ROOT = process.argv[2];
const require = createRequire(`${(process.env.FOUNDRY_APP || (process.env.FOUNDRY_APP || String.raw`C:\Program Files\Foundry Virtual Tabletop\resources\app`))}/package.json`);
const Handlebars = require("handlebars");
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), "utf8");
// Foundry's own, as it formats a signed whole number.
Handlebars.registerHelper("numberFormat", (value, options) => {
  const n = Number(value) || 0;
  return (options.hash.sign && (n >= 0)) ? `+${n}` : String(n);
});

// Foundry's own: "checked" where the value is truthy.
Handlebars.registerHelper("checked", value => (value ? "checked" : ""));

let failed = 0;
const check = (label, ok) => { if (!ok) failed++; console.log(`${ok ? "ok  " : "FAIL"}  ${label}`); };
// Against what is expected, where a check says what it should be.
const checkSame = (label, actual, expected) => check(label, JSON.stringify(actual) === JSON.stringify(expected));

const SHEET = read("module", "sheets", "actor-character-sheet.mjs");
const template = Handlebars.compile(read("templates", "parts", "actor-combat.hbs"));

const state = (key, name, extra = {}) => ({ key, name, text: `${name} text`, levels: 1, level: 0, active: false,
  levelled: false, special: false, anyone: false, pinned: false, shown: false, temporary: false, greyed: false, grantedBy: "",
  ...extra });
const context = (windowIs = null, extra = {}) => ({
  tabs: { combat: { cssClass: "active" } },
  system: { threshold: { key: "injured", label: "Injured", penalty: 3 }, might: 12, initiativeBonus: 8, soakValue: 9,
    damageReduction: 2, speed: { normal: 9, boosted: 16 }, actions: { standard: 3, counter: 2 }, attacksThisRound: 4,
    absoluteAttacks: { used: 0, max: 2 }, dot: { stacks: 0 }, lastManeuverWasInstant: false },
  workings: { might: "<table>might</table>", haste: "<table>haste</table>" },
  combatWindow: { open: Boolean(windowIs), combat: ["turn", "states", "resources", "conditions"].includes(windowIs),
    turn: windowIs === "turn", states: windowIs === "states",
    resources: windowIs === "resources", conditions: windowIs === "conditions" },
  turnChips: [{ label: "Imminent", warn: true, tip: "Death Beam by Frieza" }, { label: "Charging", tip: "Kamehameha" }],
  stateRows: [state("mindful", "Mindful", { levelled: true, levels: 3, level: 2, active: true, pinned: true, shown: true }),
    state("superior", "Superior", { active: true, shown: true, temporary: true }),
    state("surging", "Surging", { pinned: true, shown: true })],
  statePicks: { states: [state("mindful", "Mindful", { pinned: true }),
    state("superior", "Superior", { pinned: true, byDefault: true, grantedBy: "Arrogant Declaration" })],
    special: [state("entrusted", "Entrusted", { special: true, anyone: true }),
      state("liquid", "Liquid", { special: true, greyed: true }),
      state("drunk", "Drunk", { special: true, grantedBy: "Sake Bottle" })] },
  resourceRows: [{ key: "diminishing.defense", name: "Diminishing Defense", stacks: 3, max: 0, note: "Dodge -3",
    tooltip: "t", temporary: false, pinned: true }],
  resourcePicks: [{ key: "power", name: "Power", stacks: 0, max: 2, source: "", tooltip: "t", pinned: true, byDefault: true },
    { key: "unfamiliar", name: "Unfamiliar", stacks: 0, max: 3, source: "can be inflicted on you", tooltip: "t", pinned: false },
    { key: "demonicpower", name: "Demonic Power", stacks: 0, max: 0, source: "from Demonic Pressure", tooltip: "t", pinned: true }],
  conditionRows: [],
  conditionPicks: [{ key: "prone", name: "Prone", text: "Prone text", pinned: false }],
  conditionAbilities: [],
  diceBoxes: [{ label: "ToP Extra Dice", value: "1d6", tip: "x" }, { label: "Greater Dice", value: "+1d8", tip: "x" },
    { label: "Critical Dice", value: "+1d10", tip: "x" }, { label: "Max Category Increase", value: 3, tip: "x" }],
  aptitudes: { dimOffense: { value: 1, note: "Strike -2", tip: "o" }, dimDefense: { value: 3, note: "Dodge -3", tip: "d" },
    size: { value: "Medium", tip: "s" }, reach: { value: "1 sq." } },
  capacity: { spent: 12, max: 30, remaining: 18 },
  steadfast: { die: "2d10 (higher)", bonus: 2, natural: 0, target: 6 },
  capacityPercent: 40,
  threshold: { pending: ["injured"] },
  steadfastBoxes: [
    { key: "bruised", label: "Bruised", at: 187, here: false, reached: true, passed: true, auto: false, pending: false, tip: "a" },
    { key: "injured", label: "Injured", at: 93, here: true, reached: true, passed: false, auto: false, pending: true, tip: "b" },
    { key: "critical", label: "Critical", at: 37, here: false, reached: false, passed: false, auto: false, pending: false, tip: "c" }],
  combatRolls: {
    strike: { haste: 7, awareness: 5, effects: 3, total: 15, crit: 10, dice: { twice: true, line: "2d10 (higher) + 1d6" },
      workings: "<table>strike</table>" },
    dodge: { defenseValue: 14, effects: 3, total: 17, crit: 10, dice: { twice: false, line: "1d10 + 1d6" }, workings: "w" },
    strikeDice: { twice: true, short: "2d10\u2191" }, woundDice: { twice: false, short: "1d10" },
    byFoundation: [{ label: "Physical", strike: 15, strikeCrit: 10, strikeWorkings: "s", wound: 17, woundCrit: 9, woundWorkings: "w" },
      { label: "Energy", strike: 17, strikeCrit: 10, strikeWorkings: "s", wound: 17, woundCrit: 10, woundWorkings: "w" },
      { label: "Magic", strike: 15, strikeCrit: 10, strikeWorkings: "s", wound: -1, woundCrit: 10, woundWorkings: "w" }]
  },
  hidden: { from: [], of: [], any: false, summary: "" },
  actionsLeft: { standard: 2, counter: 1 },
  imminent: [{ name: "Death Beam", attackerName: "Frieza" }],
  marks: [],
  ...extra
});

const shut = template(context());
check("the Turn State is one button above everything, its chips on it - Imminent in red",
  shut.indexOf('data-window="turn"') < shut.indexOf('class="dbu-combat-top"')
    && /<span class="dbu-chip warn" data-tooltip="Death Beam by Frieza">Imminent<\/span>/.test(shut)
    && /<span class="dbu-chip" data-tooltip="Kamehameha">Charging<\/span>/.test(shut));
check("and nothing of the Turn State is drawn until it is opened",
  !shut.includes("dbu-combat-overlay") && !shut.includes("Last was Instant"));
check("three lists - States, Resources, Combat Conditions - each with its Manage, none folding",
  (shut.indexOf('data-window="states"') < shut.indexOf('data-window="resources"'))
    && (shut.indexOf('data-window="resources"') < shut.indexOf('data-window="conditions"')) && !shut.includes("<details"));
// Row by row: each list row is a `dbu-crow` of its own.
const rowOf = (html, key) => html.split('<div class="dbu-crow').find(row => row.includes(`data-state="${key}"`)) ?? "";
check("a State chosen in Manage shows unticked; one active and unchosen says temporary; a chosen one does not",
  rowOf(shut, "surging").startsWith('">') && !rowOf(shut, "surging").includes("dbu-temp")
    && rowOf(shut, "superior").startsWith(' active">') && rowOf(shut, "superior").includes("dbu-temp")
    && !rowOf(shut, "mindful").includes("dbu-temp") && rowOf(shut, "mindful").includes("2/3"));
check("a list with nothing chosen and nothing happening says how to fill it",
  shut.includes("Nothing chosen. Manage picks what shows here."));
check("a Resource row steps from the list, its note under its name",
  shut.includes('data-action="stepResource"') && shut.includes("Diminishing Defense<small>Dodge -3</small>"));
check("the Aptitudes, the Diminishing pair first, Initiative still rolled - the Dice not on the tab any more",
  !shut.includes("<em>ToP Extra Dice</em>")
    && (shut.indexOf("Dim. Offense") < shut.indexOf("<em>Might</em>")) && shut.includes('data-action="rollInitiative"')
    && shut.includes("<em>Current Size</em><span>Medium</span>") && shut.includes("9 sq."));
check("the Capacity off the Combat tab - the header's now (the user's)",
  !shut.includes('name="system.capacity.spent"') && !shut.includes("stepCapacity") && !shut.includes("left this round"));
check("the Steadfast bonus alone in the Health Threshold's title - what it needs only on hover (the user's)",
  /Health Threshold\s*<span class="panel-note" data-tooltip="A Steadfast Check: 2d10 \(higher\) \+ 2, needing 6 or more">Steadfast \+2<\/span>/.test(shut));
check("the Steadfast boxes: passed ticked, the one still to roll marked pending, one not reached shut",
  /data-threshold="bruised"[\s\S]*?checked/.test(shut.split('data-threshold="injured"')[0])
    && /class="here pending"/.test(shut) && /class=" unreached"[\s\S]*?data-threshold="critical"[^>]*disabled/.test(shut)
    && shut.includes("Bruised <span>(&le;187)</span>") && shut.includes(">-3</td>"));
check("Strike: Haste and Awareness, Effects, the total with its Critical Target and its dice - twice, marked",
  shut.includes("<em>Effects</em><span>+3</span>") && shut.includes('15 <span class="dbu-crit">(10+)</span>')
    && shut.includes('<i class="dbu-dice twice">2d10 (higher) + 1d6</i>') && shut.includes('<i class="dbu-dice">1d10 + 1d6</i>'));
check("Strike and Wound by Attack Type, each Critical Target its own, the dice in the headings",
  shut.includes("+17 <span>(9+)</span>") && shut.includes("-1 <span>(10+)</span>") && shut.includes('class="twice">2d10\u2191'));
check("nothing the Combat tab lost is left on it",
  ['data-action="resetCapacity"', 'data-action="enterEncounter"', "kiMultiplier", "Super Stacks"]
    .every(bit => !shut.includes(bit)));

// The Saving Throws where the Dice were, rolled from their names (the user's); off Main.
{
  const withSaves = template(context(null, { saves: [{ key: "corporeal", label: "Corporeal", value: 7, racial: true,
    criticalTarget: 9, workings: "w" }, { key: "morale", label: "Morale", value: 4, racial: false, criticalTarget: 10, workings: "w" }] }));
  check("the Saving Throws above the Aptitudes, rolled from their names, a racial one marked - and off Main",
    withSaves.indexOf("<h3 class=\"dbu-side-title\">Saving Throws</h3>") < withSaves.indexOf("<h3 class=\"dbu-side-title\">Aptitudes</h3>")
      && /class="stat dbu-save stat-racial">\s*<div class="dbu-save-head">\s*<button type="button" class="stat-roll" data-action="rollSave" data-save="corporeal"/.test(withSaves)
      && !read("templates", "parts", "actor-main.hbs").includes('data-action="rollSave"'));
}

// God Ki's Divine Ki is the header's now, and whether it pays the Maneuvers tab's (the user's, 2026-11-15): none of it on Combat.
{
  const withGod = template(context(null, { divineKiPercent: 50,
    system: { ...context().system, divineKi: { active: true, use: true, value: 40, max: 79 } } }));
  check("Divine Ki off the Combat tab, even with God Ki - the header's and the Maneuvers tab's",
    !withGod.includes("dbu-divine") && !withGod.includes("system.divineKi")
      && read("templates", "parts", "actor-header.hbs").includes('name="system.divineKi.value"')
      && read("templates", "parts", "actor-maneuvers.hbs").includes('name="system.divineKi.use"'));
}

check("Might rolled from its name, as the Saving Throws and Initiative are: the Base Die and Might (the user's)",
  /<button type="button" class="stat-roll" data-action="rollMight"[^>]*><em>Might<\/em><\/button>/.test(shut)
    && SHEET.includes("rollMight: DBUCharacterSheet._onMightRoll,")
    && SHEET.includes('parts: [{ label: "Might", value: might }],') && SHEET.includes('flavor: "Might Check",'));

const turn = template(context("turn"));
check("opened, the Turn State: Imminent first and wide, the Edit inside, Hidden and its button",
  turn.includes("dbu-combat-overlay") && /stat-warn stat-wide[\s\S]*?<em>Imminent<\/em><span>Death Beam<\/span>/.test(turn)
    && turn.includes('data-action="toggleCombatEdit"') && turn.includes('data-action="hideFromTargeted"')
    && turn.includes('data-action="closeCombatWindow"'));
check("no Diminishing Defense box in it any more - the Aptitudes have it",
  !/<em>Dim\. Defense<\/em>[\s\S]*Last was Instant/.test(turn.slice(turn.indexOf("dbu-combat-overlay"))));

check("the Dice at the top of the Turn State's window (the user's)",
  turn.indexOf("<em>ToP Extra Dice</em>") > turn.indexOf("dbu-combat-overlay")
    && turn.indexOf("Max Category Increase") < turn.indexOf("<em>Imminent</em>"));

// One row of four: the rule must outweigh the box grid's two columns, not merely come before or after it.
check("the Dice four in one row, over the box grid's two columns",
  /\.dbu-ttrpg \.dbu-box-grid\.dbu-dice-grid \{\s*grid-template-columns: repeat\(4, minmax\(0, 1fr\)\);/.test(read("styles", "dbu-ttrpg.css")));

// Settings' window open, the Combat tab draws none of its own: the sheet shows the first window drawn.
check("the Combat tab draws no window while the Settings tab's is open",
  !template(context("stateTriggers")).includes("dbu-combat-overlay"));

const states = template(context("states"));
check("Manage States: the five apart from the Special ones",
  states.indexOf('<div class="dbu-pick-sub">States</div>') < states.indexOf("Special States"));
check("a Special State only a Trait gives is greyed while none names it - still a checkbox",
  /class="dbu-pick greyed"[\s\S]*?data-key="liquid"/.test(states)
    && !/class="dbu-pick greyed"[^>]*>\s*<input[^>]*data-key="liquid"[^>]*disabled/.test(states));
check("a State an effect of theirs enters is ticked unasked, says which, and unticks as one there by default",
  /data-key="superior"\s*data-default="true" checked\/>\s*Superior\s*<span class="dbu-pick-from">from Arrogant Declaration<\/span>/.test(states)
    && /data-key="mindful"\s*data-default="" checked/.test(states));
check("Entrusted is not greyed, and one a Trait names says which",
  !/greyed[^>]*>\s*<input[^>]*data-key="entrusted"/.test(states) && states.includes("from Sake Bottle"));

const resources = template(context("resources"));
check("Manage Resources: what gives each, Power saying nothing, a chosen one ticked",
  resources.includes("can be inflicted on you") && resources.includes("from Demonic Pressure")
    && /data-key="power"\s*data-default="true" checked\/>\s*Power\s*<\/label>/.test(resources)
    && /data-key="demonicpower"\s*data-default="" checked/.test(resources));

// The sheet's half: what it gives the template.
check("the sheet builds every key the template reads",
  ["context.combatWindow =", "context.stateRows =", "context.statePicks =", "context.conditionRows =",
    "context.conditionPicks =", "context.resourceRows =", "context.resourcePicks =", "context.diceBoxes =",
    "context.aptitudes =", "context.capacity =", "context.steadfastBoxes =", "context.combatRolls =", "context.turnChips ="]
    .every(bit => SHEET.includes(bit)));
check("a Special State is greyed by its name with \"State\" after it, in the words of what the character carries",
  SHEET.includes("namedBy(new RegExp(`\\\\b${escapeRegex(state.name)} (Special )?State`))")
    && SHEET.includes("const traitOnly = state.special && !state.anyone;"));
check("the window is taken out of the tab to cover the sheet, and Escape closes it rather than the sheet",
  SHEET.includes('const fresh = this.element.querySelector(".tab .dbu-combat-overlay");')
    && SHEET.includes("this.element.append(fresh);") && SHEET.includes('if ((event.key !== "Escape") || !this.#combatWindow) return;'));
check("listed unasked: a State any Trait of theirs names, every Resource they can hold but Unfamiliar",
  SHEET.includes("shownOf(\"states\", state, state.active, by.length > 0)")
    && SHEET.includes('shownOf("resources", row, row.stacks > 0, reachable && (row.key !== "unfamiliar"))'));
check("unticking one listed unasked remembers it as taken off; ticking any other remembers it as put on",
  SHEET.includes("if (!byDefault) pins.add(key);") && SHEET.includes("if (byDefault) unpins.add(key);")
    && /schema\.combatUnpins = new fields\.SchemaField/.test(read("module", "data", "actor-character.mjs")));
// The user's: a State's text on hover as printed, not run together - and a Combat Condition's the same.
check("a State's or a Combat Condition's entry on hover laid out as printed",
  SHEET.includes('entryTip(effectsOnly(row.text), row.special ? ["Special State: entered only through an effect."] : [])')
    // Up to its last effect - God Ki's Divine Ki rules after it left off (the user's).
    && SHEET.includes("return (last < 0) ? lines : lines.slice(0, last + 1);")
    && template(context()).includes('data-tooltip-html="{{state.tip}}"') === false
    && read("templates", "parts", "actor-combat.hbs").includes('data-state="{{state.key}}" data-tooltip-html="{{state.tip}}"')
    && read("templates", "parts", "actor-combat.hbs").includes('data-condition="{{condition.key}}" data-tooltip-html="{{condition.tip}}"')
    && !read("templates", "parts", "actor-combat.hbs").includes("{{state.text}}"), true);
// The user's: Effects holds every effect, the penalties met at the dice among them; the total's hover is the Aptitudes +
// Effects; a Foundation's Strike is that total + what raises that Foundation alone; the Wound as it was.
check("Effects with what the roll meets at the dice - Diminishing, the Muscle Penalty, a Health Threshold's",
  ['((slot === "strike") && offense.penalty) ? { label: "Diminishing Offense", value: -offense.penalty } : null',
   '((slot === "dodge") && defense.penalty) ? { label: "Diminishing Defense", value: -defense.penalty } : null',
   'muscle ? { label: "Muscle Penalty", value: -muscle } : null',
   'thresholdPenalty ? { label: "Health Threshold", value: -thresholdPenalty } : null',
   "const raw = value + later.reduce((sum, part) => sum + part.value, 0);",
   "return { total, raw, effects: raw - base,"].every(bit => SHEET.includes(bit)));
check("the total's hover the Aptitudes and Effects alone; a Foundation's Strike the total and its own; the Wound less a Threshold's penalty",
  SHEET.includes('totalTip: breakdownTable(atLeastNothing([...sources, { label: "Effects", value: raw - base }]')
    && SHEET.includes("const raw = strikeRoll.raw + ((system.combat?.strikeBy?.[key] ?? strike) - strike);")
    && SHEET.includes('strikeWorkings: breakdownTable(atLeastNothing([partLine({ label: "Strike", value: strikeRoll.raw }),')
    // The Wound with a Health Threshold's penalty in its number too, a line of its own (the user's).
    && SHEET.includes("const raw = value - thresholdPenalty;")
    && SHEET.includes('...(thresholdPenalty ? [partLine({ label: "Health Threshold", value: -thresholdPenalty })] : [])')
    && SHEET.includes("wound: woundOf(key).total,"));
// Minimums (the user's rulebook page): no value below 0 - the totals stop there, said on their hover; Effects as it is.
check("the totals stop at 0, said on their hover",
  ['const atLeastNothing = (lines, raw) => (raw < 0) ? [...lines, floorLine(-raw, 0, "no value goes below 0")] : lines;',
   "const total = Math.max(0, raw);", "effects: raw - base,", "const value = Math.max(0, raw);",
   "tip: breakdownTable(atLeastNothing(lines, raw), total)"].every(bit => SHEET.includes(bit)));
check("a box ticked is a pass, unticked a fail",
  SHEET.includes('[`system.thresholdChecks.${key}`]: target.checked ? "pass" : "fail"'));
check("the pins are kept on the character, a list each",
  /schema\.combatPins = new fields\.SchemaField\(\{\s*states: new fields\.ArrayField/.test(read("module", "data", "actor-character.mjs")));
check("Determined is a Special State; Entrusted and Spectator within anyone's reach",
  /specialState: true/.test(read("traits", "states", "determined.dbu"))
    && ["entrusted", "spectator"].every(id => /anyoneMayEnter: true/.test(read("traits", "states", `${id}.dbu`))));

const SETTINGS = read("templates", "parts", "actor-settings.hbs");
const MAIN = read("templates", "parts", "actor-main.hbs");
const PROGRESSION = read("templates", "parts", "actor-progression.hbs");
check("Settings has the round and Encounter buttons and the Ki Multiplier",
  ['data-action="resetCapacity"', 'data-action="resetEncounter"', 'data-action="enterEncounter"', 'name="system.debug.kiMultiplier"']
    .every(bit => SETTINGS.includes(bit)));
// Main's own Aptitudes gone since (the user's, planning the Adversaries): Surgency and the Stress Bonus on the Combat tab.
check("Main has no Aptitude left: Surgency the Combat tab's, with what moved before - the Stress Bonus Progression's (the user's, 2026-11-15)",
  shut.includes("<em>Surgency</em>") && !shut.includes("<em>Stress Bonus</em>") && PROGRESSION.includes("{{system.stressBonus}}")
    && !["{{system.surgency}}", "{{system.stressBonus}}", "{{system.ingenuity}}", "{{system.might}}", "{{system.soakValue}}",
      "{{system.speed.normal}}", 'data-action="rollInitiative"'].some(bit => MAIN.includes(bit)));
check("ToP Mod and Crit Target gone from both, Custom Buffs doing them (the user's, 2026-11-16); Debug's buttons a row each kind",
  ['name="system.tierOfPowerModifier"', 'name="system.criticalTarget"'].every(bit => !SETTINGS.includes(bit) && !PROGRESSION.includes(bit))
    && ((SETTINGS.match(/class="capacity dbu-debug-row"/g) ?? []).length === 3));
{
  // Progression's one row (the user's): Level, each Score, the TP left after Unique Abilities and Techniques, and the total.
  const PROG = Handlebars.compile(PROGRESSION)({ system: { powerLevel: 7 }, raceOptions: [], sizeOptions: [], subraceOptions: [],
    attributeColumns: [{ key: "agility", abbr: "AGI", score: 9 }, { key: "force", abbr: "FOR", score: 5 }],
    tpSummary: { total: 30, spent: 34, left: -4, over: true, unique: 20, techniques: 14 }, progressionRows: [], characterPerks: [] });
  const row = PROG.slice(PROG.indexOf('class="progression-table dbu-progress-row"'), PROG.indexOf("</table>", PROG.indexOf("dbu-progress-row")));
  // Between the Racial Grants and the Power Level table, in that table's colours (the user's).
  check("Level and Total TP as wide as the table's Level and TP under them; the Scores grouped under their own heading, the table's colours",
    /<colgroup>\s*<col class="col-level"\/>\s*<col\/><col\/>\s*<col class="col-tp"\/>\s*<col class="col-tp"\/>\s*<\/colgroup>/.test(row)
      && (row.match(/class="dbu-score dbu-score-first"/g) ?? []).length === 2
      && (row.match(/class="dbu-score dbu-score-last"/g) ?? []).length === 2
      && !/th\.dbu-score \{\s*background/.test(read("styles", "dbu-ttrpg.css")));
  check("the row between the Racial Grants and the Power Level table, in its colours",
    (PROGRESSION.indexOf("racial-grants") < PROGRESSION.indexOf("dbu-progress-row"))
      && (PROGRESSION.indexOf("dbu-progress-row") < PROGRESSION.indexOf('<table class="progression-table">'))
      && PROGRESSION.includes('<table class="progression-table dbu-progress-row">'));
  check("Progression's one row: Level, each Score, TP left, Total TP - overspent in red",
    [...row.matchAll(/<th scope="col(?:group)?"[^>]*>([^<]+?)\s*(?:<span[^>]*>[^<]*<\/span>)?<\/th>/g)].map(m => m[1]).join("|") === "Level|Attribute Scores|TP Left|Total TP|AGI|FOR"
      && /<th scope="colgroup" colspan="2" class="dbu-score-group"\s+data-tooltip="Score cap at ToP [^"]*">Attribute Scores <span class="dbu-score-cap">&middot; cap [^<]*<\/span><\/th>/.test(row)
      && [...row.matchAll(/<td[^>]*>(-?\d+)<\/td>/g)].map(m => m[1]).join("|") === "7|9|5|-4|30"
      && /class="dbu-over"/.test(row)
      && SHEET.includes("context.tpSummary = { total, spent, left: total - spent, over: (spent > total) && !isAdversary(this.actor),")
      && !PROGRESSION.includes("character-readout") && PROGRESSION.includes('<span class="dbu-readout-box">{{system.stressBonus}}</span>'));
  // The Stress Bonus a box like the Power Level's, with one hover over the whole of it (the user's: two, by where the mouse was).
  {
    const at = PROGRESSION.indexOf('<label class="dbu-readout"');
    const box = PROGRESSION.slice(at, PROGRESSION.indexOf("</label>", at));
    checkSame("the Stress Bonus: one hover - what it is, then its workings - over a box",
      [(box.match(/data-tooltip/g) ?? []).length, box.includes("<p>A Stress Test is 1d10 plus this.</p>{{workings.stressBonus}}"), box.includes("dbu-readout-box")],
      [1, true, true]);
  }
  // The Aptitudes in the user's pairs (2026-11-15); the Diminishing counters in the Turn State; Long Range a box of its own.
  const COMBAT = read("templates", "parts", "actor-combat.hbs");
  const aptitudes = COMBAT.slice(COMBAT.indexOf('<h3 class="dbu-side-title">Aptitudes</h3>'), COMBAT.indexOf('<div class="dbu-capacity-row">'));
  checkSame("the Aptitudes, two by two: Might | Initiative, Soak Value | Damage Reduction, Current Size | Surgency, Melee Reach | Long Range, the Speeds",
    [...aptitudes.matchAll(/<em>([^<]+)<\/em>/g)].map(m => m[1]),
    ["Might", "Initiative", "Soak Value", "Damage Reduction", "Current Size", "Surgency", "Melee Reach", "Long Range", "Speed", "Speed (Boosted)"]);
  const turn = COMBAT.slice(COMBAT.indexOf("<em>Attacks this round</em>"), COMBAT.indexOf("<em>Absolute Attacks</em>"));
  checkSame("Dim. Offense and Dim. Defense in the Turn State, after the attacks that wear them",
    [turn.includes("<em>Dim. Offense</em>"), turn.includes("<em>Dim. Defense</em>"), aptitudes.includes("Dim.")], [true, true, false]);
  checkSame("Long Range from 9, 2 more a Size after Large, and what an effect moves it by",
    [SHEET.includes("const squares = LONG_RANGE_SQUARES + sized + moved;"), SHEET.includes("const sized = 2 * sizesAboveLarge(this.actor);"),
     SHEET.includes('const moved = Number(this.actor.system.effects?.slots?.["longRange.squares"]?.add) || 0;'), SHEET.includes("longRange: this.#longRangeBox()")],
    [true, true, true, true]);
  check("a new character's Size picked as Medium where the sheet cannot read one",
    SHEET.includes('const built = (read in DBUCharacterData.SIZES) ? read : DBUCharacterData.DEFAULT_SIZE;'));
}
check("Progression no longer shows Haste, Awareness or the Defense Value",
  !["{{system.haste}}", "{{system.awareness}}", "{{system.defenseValue}}"].some(bit => PROGRESSION.includes(bit)));

console.log(failed ? `\n${failed} failing` : "\n0 failing");
process.exit(failed ? 1 : 0);
