/**
 * Born for Battle (2) (the user's question, 2026-11-15): knocked through a Health Threshold and chosen, it uses a Ki Surge and gains
 * a stack of Battle Born - its script queues both, and the stack verb writes one, on the Combat Roll chosen.
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.argv[2];
const APP = (process.env.FOUNDRY_APP || String.raw`C:\Program Files\Foundry Virtual Tabletop\resources\app`);
const appUrl = p => pathToFileURL(path.join(APP, p)).href;
const modUrl = p => pathToFileURL(path.join(ROOT, "module", p)).href;
globalThis.CONST = {};
globalThis.foundry = {};
await import(appUrl("common/primitives/_module.mjs"));
globalThis.foundry.utils = { ...await import(appUrl("common/utils/_module.mjs")) };
globalThis.foundry.data = await import(appUrl("common/data/_module.mjs"));
const { default: DataModel } = await import(appUrl("common/abstract/data.mjs"));
globalThis.foundry.abstract = { DataModel, TypeDataModel: DataModel };
globalThis.ui = { notifications: { warn: () => {}, error: () => {}, info: () => {} } };
const TRAITS = path.join(ROOT, "traits");
globalThis.foundry.utils.fetchJsonWithTimeout = async () => JSON.parse(fs.readFileSync(path.join(TRAITS, "index.json"), "utf8"));
globalThis.fetch = async url => {
  const file = path.join(TRAITS, String(url).replace("systems/dbu-ttrpg/traits/", ""));
  if (!fs.existsSync(file)) return { ok: false, status: 404, statusText: "missing" };
  return { ok: true, status: 200, text: async () => fs.readFileSync(file, "utf8") };
};
const { loadTraits, getTrait } = await import(modUrl("effects/traits.mjs"));
await loadTraits();
const { compile } = await import(modUrl("effects/parser.mjs"));
const { collectReactive } = await import(modUrl("effects/interpreter.mjs"));

let failed = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`);
};

const { program, errors } = compile(getTrait("born-for-battle").script);
const entry = { program, armed: true, available: true, sourceId: "born-for-battle", sourceName: "Born for Battle" };
const scope = { data: { resources: {}, tierOfPower: 2 }, errors: [], context: {}, queue: [] };
const { spent } = collectReactive([entry], "threshold", scope, { mode: "triggered" });
check("compiles; chosen at a Threshold, the (2) answers and queues a Ki Surge, then a Battle Born stack on Strike, Dodge or Wound",
  [errors.length, spent.length, scope.queue.map(call => [call.verb, call.args])],
  [0, 1, [["surge", ["ki"]], ["gainOneOf", ["battlebornstrike", "battleborndodge", "battlebornwound"]]]]);

// The stack verb as it runs: the one chosen gets one.
const RT = fs.readFileSync(path.join(ROOT, "module", "effects", "moments-runtime.mjs"), "utf8").replace(/\r\n/g, "\n");
const gain = RT.slice(RT.indexOf('    case "gainOneOf": {'), RT.indexOf('    case "surge": {'));
check("the stack verb asks which Combat Roll, adds 1 to it, and says it was gained; not answered, it says it was left unplaced",
  [gain.includes("await askPlayerChoice(actor,"), gain.includes("stacks: (Number(held[chosen]?.stacks) || 0) + 1"),
   gain.includes("await stacksGained(actor, [chosen]);\n      return { placed: chosen };"),
   gain.includes('if (!chosen) return { unplaced: { names: args.map(name => String(name).toLowerCase()), source: definitions[open[0]].source || "" } };')],
  [true, true, true, true]);

// Unplaced (the user's: Born for Battle (2) applied by the GM, its question never answered): a line in the chat with "Place it".
check("the pass gathers what was left unplaced and says it in a message of its own, counting its stacks",
  [RT.includes("if (result?.unplaced) unplaced.push(result.unplaced);"),
   RT.includes("${unplaced.map((each, at) => unplacedLine(actor, each, at)).join(\"\")}</ul></div>`,"),
   RT.includes('flags: { "dbu-ttrpg": { unplacedCount: unplaced.length } } });'), RT.includes("regained.push(...unplaced")], [true, true, true, false]);
globalThis.Handlebars = { escapeExpression: text => String(text ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;") };
const lineFn = RT.slice(RT.indexOf("export function unplacedLine("), RT.indexOf("\n}\n", RT.indexOf("export function unplacedLine(")) + 3).replace(/^export /, "");
const unplacedLine = new Function(`${lineFn}; return unplacedLine;`)();
const line = unplacedLine({ uuid: "Actor.goku" }, { names: ["battlebornstrike", "battleborndodge", "battlebornwound"], source: "Born for Battle" }, 1);
check("the line: whose stack, and its button with the character, the Resources and its index",
  [line.includes("Born for Battle: a stack not placed"), line.includes('data-place-index="1"'), line.includes('data-place-actor="Actor.goku"'),
   line.includes('data-place-names="battlebornstrike,battleborndodge,battlebornwound">Place it</button>')], [true, true, true, true]);

const CH = fs.readFileSync(path.join(ROOT, "module", "chat.mjs"), "utf8").replace(/\r\n/g, "\n");
const renderFn = CH.slice(CH.indexOf("function renderPlaceStack("), CH.indexOf("\n}\n", CH.indexOf("function renderPlaceStack(")) + 3);
const calls = [];
const renderPlaceStack = new Function("SCOPE", "fromUuidSync", "requestEdit", "document", `${renderFn}; return renderPlaceStack;`)(
  "dbu-ttrpg", uuid => ({ "Actor.mine": { isOwner: true }, "Actor.theirs": { isOwner: false } }[uuid] ?? null),
  (message, request) => calls.push(request), { createElement: () => ({}) });
const button = (index, actor) => ({ dataset: { placeIndex: String(index), placeActor: actor, placeNames: "a,b" }, state: "kept", listeners: 0,
  replaceWith(node) { this.state = `replaced:${node.textContent}`; }, remove() { this.state = "removed"; }, addEventListener() { this.listeners++; } });
const buttons = [button(0, "Actor.mine"), button(1, "Actor.mine"), button(2, "Actor.theirs")];
renderPlaceStack({ getFlag: () => [0] }, { querySelectorAll: () => buttons });
check("drawn: one placed says so; the owner's waits for a click; not theirs, no button",
  buttons.map(each => [each.state, each.listeners]), [["replaced:- placed", 0], ["kept", 1], ["removed", 0]]);
check("clicked: asks again, back if not answered, else the message marked through the GM's edit; wired on every render",
  [renderFn.includes('runVerbNamed(actor, "gainOneOf", String(button.dataset.placeNames ?? "").split(",").filter(Boolean))'),
   renderFn.includes("if (result?.unplaced) { button.disabled = false; return; }"), renderFn.includes('await requestEdit(message, { type: "stackPlaced", index });'),
   CH.includes('case "stackPlaced": {'), CH.includes("  renderCriticalButton(message, html);\n  renderPlaceStack(message, html);")],
  [true, true, true, true, true]);

// Placed: the message gone once every stack on it is (the user's), marked till then.
const caseAt = CH.indexOf('    case "stackPlaced": {');
const caseBody = CH.slice(CH.indexOf("{", caseAt) + 1, CH.indexOf("\n    }\n", caseAt));
const placeCase = new Function("SCOPE", "game", "request", caseBody);
const fakeMessage = (count, placed = []) => {
  const flags = { unplacedCount: count, stacksPlaced: placed };
  return { flags, deleted: false, getFlag: (scope, key) => flags[key], setFlag(scope, key, value) { flags[key] = value; }, delete() { this.deleted = true; } };
};
const one = fakeMessage(1), two = fakeMessage(2), twoLater = fakeMessage(2, [0]);
for (const [message, index] of [[one, 0], [two, 0], [twoLater, 1]]) placeCase("dbu-ttrpg", { messages: { get: () => message } }, { messageId: "m", index });
check("its one stack placed: the message deleted; one of two: marked and kept; the second: deleted",
  [one.deleted, [two.deleted, two.flags.stacksPlaced], twoLater.deleted], [true, [false, [0]], true]);
console.log(failed ? `${failed} failing` : "all passing");
process.exit(failed ? 1 : 0);
