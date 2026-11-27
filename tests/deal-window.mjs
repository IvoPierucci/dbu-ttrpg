// The Deal Damage window's sum (the user's: a Gigantic Shapeshift's Punching Down not seen): what the Damage holds past Wound, Soak
// and DR - a Barrier off, Punching Down on - written in it, as on the attack card's line.
import fs from "node:fs";
import path from "node:path";
const CHAT = fs.readFileSync(path.join(process.argv[2], "module", "chat.mjs"), "utf8").replace(/\r\n/g, "\n");
let failed = 0;
const check = (label, ok) => { if (!ok) failed++; console.log(`${ok ? "ok  " : "FAIL"}  ${label}`); };
const at = CHAT.indexOf("async function dealDamageWindow(");
const win = CHAT.slice(at, CHAT.indexOf("\n}\n", at));
check("Punching Down in the window's sum", win.includes("own.punchingDown} Punching Down</span>"));
check("and a Barrier", win.includes("Number(own.barrier.total) || 0} ${esc(own.barrier.name)}</span>"));
check("as on the card's line", CHAT.includes("const down = own.punchingDown ? ` + Punching Down ${own.punchingDown}` : \"\";"));
check("Punching Down still rolled 2+ Categories down, on Damage there is",
  CHAT.includes("const punchingRoll = ((dealt > 0) && (gap >= ((attacker.system?.effects?.slots?.[\"troll.punchDown\"] === true) ? 1 : 2)) && !own.noPunchingDown)"));
console.log(failed ? `${failed} failing` : "all passing");
process.exit(failed ? 1 : 0);
