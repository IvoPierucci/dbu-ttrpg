/**
 * The instrument the whole first stretch is verified with.
 *
 * There is no test runner in this system, so verification is done by comparing what the
 * pipeline produces before and after a change. `snapshot` gives a stable picture of
 * every derived value; `explain` says which effect moved which number and why. Together
 * they turn "did the refactor change anything?" from a question into a diff.
 */

import { programsFor } from "./registry.mjs";
import { resolveAmount, resolveDice } from "./amounts.mjs";
import { evaluate } from "./conditions.mjs";

/**
 * Every value the pipeline derives, in a shape that can be compared as text.
 *
 * Deliberately flat and sorted: two snapshots taken on either side of a refactor are
 * meant to be diffed, and a stable key order is what makes that diff readable.
 */
export function snapshot(actor) {
  const s = actor.system;
  const out = {};

  const put = (key, value) => {
    if (value === undefined) return;
    out[key] = (typeof value === "number") ? value : JSON.parse(JSON.stringify(value));
  };

  put("powerLevel", s.powerLevel);
  put("baseTierOfPower", s.baseTierOfPower);
  put("tierOfPower", s.tierOfPower);
  put("attributeScoreCap", s.attributeScoreCap);

  for (const [key, a] of Object.entries(s.attributes ?? {})) {
    put(`attribute.${key}.score`, a.score);
    put(`attribute.${key}.mod`, a.mod);
  }
  for (const [key, skill] of Object.entries(s.skills ?? {})) {
    put(`skill.${key}.bonus`, skill.bonus);
    put(`skill.${key}.ranks`, skill.ranks);
  }
  for (const [key, save] of Object.entries(s.savingThrows ?? {})) {
    put(`save.${key}.value`, save.value);
    put(`save.${key}.criticalTarget`, save.criticalTarget);
  }

  put("life.max", s.life?.max);
  put("ki.max", s.ki?.max);
  put("capacity.max", s.capacity?.max);
  put("soakValue", s.soakValue);
  put("damageReduction", s.damageReduction);
  put("defenseValue", s.defenseValue);
  put("might", s.might);
  put("haste", s.haste);
  put("awareness", s.awareness);
  put("surgency", s.surgency);
  put("stressBonus", s.stressBonus);
  put("criticalTarget", s.criticalTarget);
  put("botchRange", s.botchRange);
  put("speed.normal", s.speed?.normal);
  put("speed.boosted", s.speed?.boosted);
  put("initiativeBonus", s.initiativeBonus);
  put("combat.strike", s.combat?.strike);
  put("combat.dodge", s.combat?.dodge);
  put("combat.wound", s.combat?.wound);
  put("dice.extra", s.dice?.extra?.formula);
  put("dice.greater", s.dice?.greater?.formula);
  put("dice.critical", s.dice?.critical?.formula);
  put("diminishing.offense.penalty", s.diminishing?.offense?.penalty);
  put("diminishing.defense.perAttack", s.diminishing?.defense?.perAttack);
  put("threshold.key", s.threshold?.key);
  put("threshold.penalty", s.threshold?.penalty);

  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

/**
 * What each active effect contributed, and why it applied.
 *
 * This is what makes a wrong number findable. Without it the only way to know whether a
 * Talent is doing anything is to take it off and watch the sheet.
 */
export function explain(actor) {
  const errors = [];
  const entries = programsFor(actor, { report: message => errors.push(message) });
  const bag = actor.system.effects ?? {};

  const out = entries.flatMap(entry =>
    (entry.program.blocks ?? []).map(b => ({
      source: entry.sourceName,
      effect: b.index,
      mode: b.mode,
      moment: b.moment ?? null,
      text: b.text || null,
      active: (bag.active ?? []).some(a =>
        (a.sourceId === entry.sourceId) && (a.block === b.index)),
      changes: describe(b.statements)
    }))
  );

  return {
    effects: out,
    slots: bag.slots ?? {},
    errors: [...errors, ...(bag.errors ?? [])]
  };
}

/** A block's statements as short readable lines, for the report above. */
function describe(statements, depth = 0) {
  const pad = "  ".repeat(depth);
  return (statements ?? []).flatMap(s => {
    switch (s.type) {
      case "assign":
        return [`${pad}${s.slot} ${symbol(s.op)} ${amountText(s.amount)}`];
      case "if":
        return [
          `${pad}if ${conditionText(s.condition)}`,
          ...describe(s.then, depth + 1),
          ...(s.else?.length ? [`${pad}else`, ...describe(s.else, depth + 1)] : [])
        ];
      case "forbid":
        return [`${pad}forbid ${s.what}`];
      case "call":
        return [`${pad}${s.verb}()`];
      default:
        return [`${pad}?`];
    }
  });
}

const symbol = op => ({ add: "+=", multiply: "*=", set: "=", min: "min=", max: "max=",
                        "add-dice": "+= dice" })[op] ?? op;

function amountText(a) {
  if (!a) return "0";
  switch (a.type) {
    case "flat": return String(a.value);
    case "boolean": return a.value ? "true" : "false";
    case "perTier": return `${a.value}(T)`;
    case "perBaseTier": return `${a.value}(bT)`;
    case "level": return a.scale ? `L(${a.scale})` : "L";
    case "dice": return a.from ? `${a.from}Dice`
      : a.scale ? `${a.formula}(${a.scale})` : a.formula;
    case "path": return a.path;
    case "binary": return `${amountText(a.left)} ${a.op} ${amountText(a.right)}`;
    case "ternary": return `${conditionText(a.condition)} ? ${amountText(a.then)} : ${amountText(a.else)}`;
    case "call": return `${a.fn}(${(a.args ?? []).map(amountText).join(", ")})`;
    default: return "?";
  }
}

function conditionText(c) {
  if (!c) return "always";
  switch (c.type) {
    case "compare": return `${amountText(c.left)} ${c.op} ${amountText(c.right)}`;
    case "logical": return `(${conditionText(c.left)} ${c.op} ${conditionText(c.right)})`;
    case "not": return `!${conditionText(c.operand)}`;
    case "predicate": return `${c.name}(${(c.args ?? []).join(", ")})`;
    default: return "?";
  }
}

/**
 * What a program comes to for one character, in plain lines.
 *
 * Shown beside the script on a Talent's sheet, because "does this compile" is only half
 * the question an author has - the other half is what it works out to for the character
 * holding it, and the only way to answer that before this was to close the sheet and
 * watch the numbers.
 */
export function describeFor(program, actor) {
  const scope = { data: actor.system, errors: [], level: 0, context: {} };

  return (program?.blocks ?? []).flatMap(b => {
    const head = (b.mode === "passive") ? "" : `[${b.mode}${b.moment ? "/" + b.moment : ""}] `;
    return (b.statements ?? []).flatMap(s => resolved(s, scope, head));
  });
}

function resolved(s, scope, head) {
  switch (s.type) {
    case "assign": {
      const value = (s.amount?.type === "dice")
        ? resolveDice(s.amount, scope)
        : resolveAmount(s.amount, scope);
      const sign = (s.op === "add") && (typeof value === "number") && (value >= 0) ? "+" : "";
      return [`${head}${s.slot} ${symbol(s.op)} ${sign}${value}`];
    }
    case "if": {
      // Whether the condition holds right now is the useful part: a Talent gated on
      // equal Scores is worth being told is doing nothing today.
      const holds = evaluate(s.condition, scope);
      const inner = (holds ? s.then : s.else) ?? [];
      const note = holds ? "" : " (not right now)";
      return inner.length
        ? inner.flatMap(one => resolved(one, scope, head)).map(line => line + note)
        : [`${head}${conditionText(s.condition)}${note}`];
    }
    case "forbid": return [`${head}forbids ${s.what}`];
    case "call": return [`${head}${s.verb}()`];
    default: return [];
  }
}

/** Hang the instrument off `game` so it can be reached from the console. */
export function registerDebugTools() {
  game.dbu ??= {};
  game.dbu.effects = { snapshot, explain };
}
