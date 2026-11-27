/**
 * Edits relayed to the GM for one card: carried out one after another, in the order they came (chat.mjs queuedEdit) - the user's
 * report, a player's Counter Maneuver answered as a Dodge: its defence and "this answer is done" carried out side by side.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.argv[2];
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), "utf8").replace(/\r\n/g, "\n");
let failed = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`);
};

const CHAT = read("module", "chat.mjs");
const at = CHAT.indexOf("const editQueues = new Map();");
const end = CHAT.indexOf("/** Carry out one relayed edit.", at);
const queuedEdit = new Function(`${CHAT.slice(at, end).replace("export function queuedEdit", "function queuedEdit")}; return queuedEdit;`)();

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const order = [];
// The card as the GM holds it: the defence written slowly (a server round trip), "done" reading it at once.
const card = { defences: [] };
const writeDefence = async () => { order.push("defence starts"); const copy = { defences: [...card.defences, "parry"] }; await wait(30);
  card.defences = copy.defences; order.push("defence written"); };
const answerDone = async () => { order.push("done reads"); const seen = [...card.defences]; await wait(5); card.defences = seen; order.push("done written"); };
await Promise.all([queuedEdit("m1", writeDefence), queuedEdit("m1", answerDone)]);
check("one card's relayed edits one after another: the defence written before \"done\" reads the card, and kept",
  [order, card.defences], [["defence starts", "defence written", "done reads", "done written"], ["parry"]]);

const other = [];
await Promise.all([queuedEdit("a", async () => { other.push("a starts"); await wait(20); other.push("a ends"); }),
  queuedEdit("b", async () => { other.push("b starts"); await wait(1); other.push("b ends"); })]);
check("another card's not held up by it", other, ["a starts", "b starts", "b ends", "a ends"]);

const after = [];
await Promise.allSettled([queuedEdit("c", async () => { throw new Error("refused"); }), queuedEdit("c", async () => { after.push("next"); })]);
check("one that fails does not stop the next", after, ["next"]);

check("the GM's socket carries every relayed edit through it",
  CHAT.includes("await queuedEdit(request?.messageId, () => applyRequest(request));"), true);

console.log(failed ? `${failed} failing` : "all passing");
process.exit(failed ? 1 : 0);
