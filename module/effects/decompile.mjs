/**
 * Turning a program back into script text.
 *
 * Two uses. It is how a Talent that still carries the old data rows can be shown as a
 * script without anyone rewriting it by hand, and it is half of the round-trip check
 * that says the language and the engine agree: compile what this produces and you
 * should get the same program back.
 */

/** One program as text, blocks separated by a blank line. */
export function decompile(program) {
  return (program?.blocks ?? []).map(blockText).join("\n\n");
}

function blockText(b) {
  const header = [];

  if ((b.mode === "triggered") || (b.mode === "automatic")) {
    header.push(b.moment ? `${b.mode}/${b.moment}` : b.mode);
  }
  else header.push("passive");

  if (b.modifiers?.perStack) header[0] += " per stack";
  if (b.modifiers?.fromLevel) header[0] += ` from ${b.modifiers.fromLevel}`;
  if (b.modifiers?.after) header[0] += ` after ${b.modifiers.after}`;

  if (b.budget?.round) header.push(`${b.budget.round}/round`);
  if (b.budget?.encounter) header.push(`${b.budget.encounter}/encounter`);
  if (b.budget?.actions) header.push(`costs ${b.budget.actions} action`);
  if (b.modifiers?.grantsManeuver) header.push(`${b.modifiers.grantsManeuver} maneuver`);
  if (b.modifiers?.before) header.push("before");
  if (b.modifiers?.first) header.push("first");

  const lines = [`[${header.join(", ")}]`];
  if (b.requires) lines.push(`requires ${conditionText(b.requires)};`);
  lines.push(...statements(b.statements, 0));
  return lines.join("\n");
}

function statements(list, depth) {
  const pad = "    ".repeat(depth);
  return (list ?? []).flatMap(s => {
    switch (s.type) {
      case "assign": {
        // An add of a negated amount is written back as the subtraction it was.
        const negated = (s.op === "add") && (s.amount?.type === "binary")
          && (s.amount.op === "-") && (s.amount.left?.type === "flat") && (s.amount.left.value === 0);
        const op = negated ? "-=" : OPS[s.op] ?? "+=";
        const amount = negated ? s.amount.right : s.amount;
        return [`${pad}${s.slot} ${op} ${amountText(amount)};`];
      }
      case "if": {
        const head = `${pad}if (${conditionText(s.condition)}) {`;
        const body = statements(s.then, depth + 1);
        if (!s.else?.length) return [head, ...body, `${pad}}`];
        return [head, ...body, `${pad}} else {`, ...statements(s.else, depth + 1), `${pad}}`];
      }
      case "forbid":
        return [`${pad}${s.allow ? "allow" : "forbid"} ${s.what};`];
      case "call":
        return [`${pad}${s.verb}(${(s.args ?? []).map(amountText).join(", ")});`];
      default:
        return [`${pad}// ?`];
    }
  });
}

const OPS = { add: "+=", multiply: "*=", set: "=", min: "min=", max: "max=", "add-dice": "+=" };

function amountText(a) {
  if (!a) return "0";
  switch (a.type) {
    case "flat": return String(a.value);
    case "boolean": return a.value ? "true" : "false";
    case "perTier": return `${a.value}(T)`;
    case "perBaseTier": return `${a.value}(bT)`;
    case "level": return a.scale ? `L(${a.scale})` : "L";
    case "dice":
      if (a.from) return `${a.from}Dice`;
      return a.scale ? `${a.formula}(${a.scale})` : a.formula;
    case "path": return a.path;
    case "name": return `"${a.value}"`;
    case "binary": return `(${amountText(a.left)} ${a.op} ${amountText(a.right)})`;
    case "ternary":
      // Bracketed, for the reason a binary is: `?:` binds looser than everything else,
      // so a ternary used as one side of a comparison loses its shape written flat -
      // `n < (isMinion ? 1 : 2)` reads back as `(n < isMinion) ? 1 : 2`, which asks a
      // different question and still compiles.
      return `(${conditionText(a.condition)} ? ${amountText(a.then)} : ${amountText(a.else)})`;
    case "call": return `${a.fn}(${(a.args ?? []).map(amountText).join(", ")})`;
    case "predicate": return predicateText(a);
    default: return "0";
  }
}

function conditionText(c) {
  if (!c) return "true";
  switch (c.type) {
    case "compare": {
      // A bare amount compared against zero is how "is this true" is stored; written
      // back the short way it was typed.
      if ((c.op === "!=") && (c.right?.type === "flat") && (c.right.value === 0)) {
        return amountText(c.left);
      }
      return `${amountText(c.left)} ${c.op} ${amountText(c.right)}`;
    }
    case "logical": {
      // Bracketed when nested, or the grouping is lost: `a && (b || c)` written flat
      // reads back as `(a && b) || c`, which is a different condition. The parser
      // accepted the brackets all along; only writing them back was missing.
      const side = part => (part?.type === "logical")
        ? `(${conditionText(part)})` : conditionText(part);
      return `${side(c.left)} ${c.op} ${side(c.right)}`;
    }
    case "not": {
      // Same reason: `!(a && b)` is not `!a && b`.
      const inner = conditionText(c.operand);
      return (c.operand?.type === "logical") ? `!(${inner})` : `!${inner}`;
    }
    case "predicate": return predicateText(c);
    default: return "true";
  }
}

function predicateText(p) {
  if (!p.args?.length) return p.name;
  const args = p.args.map(a => (typeof a === "string") ? `"${a}"` : amountText(a));
  return `${p.name}(${args.join(", ")})`;
}
