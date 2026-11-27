/**
 * What the Strike was worth against a target, on the attack card (the user's report: "Strike 22 against them" told the attacker's
 * roll). Several targets: "Higher / Lower Strike against them", no number. One target: summed into the Strike itself, shown in
 * its hover, nothing said on the target's line.
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.argv[2];
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), "utf8").replace(/\r\n/g, "\n");
let failed = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`);
};

const { partLine, noteLine } = await import(pathToFileURL(path.join(ROOT, "module", "breakdown.mjs")).href);
const CHAT = read("module", "chat.mjs");
const at = CHAT.indexOf("/** What the Strike was worth against one target past the roll itself");
const end = CHAT.indexOf("/**\n * A target's line on the card.", at);
const attackTargets = attack => attack.targets ?? [{ uuid: attack.targetUuid, name: attack.targetName }];
const targetResult = (attack, uuid) => (attack.result?.targets ?? []).find(entry => entry.uuid === uuid) ?? null;
const fns = new Function("partLine", "noteLine", "attackTargets", "targetResult",
  `${CHAT.slice(at, end)}; return { againstLines, strikeAgainstNote, strikeFolded, strikeShown };`)(partLine, noteLine, attackTargets, targetResult);

const strike = { total: 20, lines: [partLine({ label: "Strike", value: 20 })], actorUuid: "Actor.a" };
const lockOn = { uuid: "Actor.t", against: 26, strikeBase: 20, analysisRows: [{ label: "Lock On", value: 6 }], longRange: 0, answer: { total: 14 } };
const one = { targets: [{ uuid: "Actor.t", name: "Sereh" }], result: { strike, targets: [lockOn] } };
const shown = fns.strikeShown(one);
check("one target: Lock On summed into the Strike, and in its hover", [fns.strikeFolded(one), shown.total, shown.lines.map(l => l.source)],
  [true, 26, ["Strike", "Lock On"]]);
check("and the roll itself left as it was", strike.total, 20);

const far = { ...lockOn, analysisRows: [], longRange: 25 };
const floored = fns.strikeShown({ ...one, result: { strike, targets: [far] } });
check("one target at Long Range: taken off, floored at nothing and said", [floored.total, floored.lines.at(-1).source], [0, "Floored at 0"]);

const nothing = { ...lockOn, analysisRows: [], against: 20 };
check("one target and nothing against them: the Strike as rolled", fns.strikeShown({ ...one, result: { strike, targets: [nothing] } }), strike);
check("a forced hit or a blocked Technique: not folded",
  [fns.strikeFolded({ ...one, result: { strike, targets: [{ ...lockOn, forced: "Lost the Duel" }] } }),
   fns.strikeFolded({ ...one, techniqueBlocked: true })], [false, false]);

const two = { targets: [{ uuid: "Actor.t" }, { uuid: "Actor.u" }], result: { strike, targets: [lockOn, { ...nothing, uuid: "Actor.u" }] } };
check("several targets: said on each line, which way and not how much",
  [fns.strikeFolded(two), fns.strikeAgainstNote(6), fns.strikeAgainstNote(-4), fns.strikeAgainstNote(0)],
  [false, "Higher Strike against them", "Lower Strike against them", ""]);
check("the number is never written on a target's line",
  [CHAT.includes("Strike ${own.against} against them"), CHAT.includes("if (strikeFolded(attack)) return attackSide(label, target.name, own.answer);")],
  [false, true]);

console.log(failed ? `${failed} failing` : "all passing");
process.exit(failed ? 1 : 0);
