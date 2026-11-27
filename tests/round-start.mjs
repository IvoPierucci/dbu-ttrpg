// A new Combat Round begun by the GM once it is written, whoever moved it (the user's report: a player ending the Round's last turn
// moved it on their own client, Foundry's `combatRound` ran there alone, and the GM never began the Round - Actions and Capacity
// not given back, Born for Battle never asked). Checked on the turn-change handler's own text, and on Foundry's own code.
import fs from "node:fs";
import path from "node:path";
const COMBAT = fs.readFileSync(path.join(process.argv[2], "module", "combat.mjs"), "utf8").replace(/\r\n/g, "\n");
const FOUNDRY = fs.readFileSync(`${(process.env.FOUNDRY_APP || (process.env.FOUNDRY_APP || String.raw`C:\Program Files\Foundry Virtual Tabletop\resources\app`))}/client/documents/combat.mjs`, "utf8").replace(/\r\n/g, "\n");
let failed = 0;
const check = (label, ok) => { if (!ok) failed++; console.log(`${ok ? "ok  " : "FAIL"}  ${label}`); };
check("Foundry: combatRound called before the Round is written, on the moving client",
  /Hooks\.callAll\("combatRound", this, updateData, updateOptions\);\s*await this\.update\(updateData, updateOptions\);/.test(FOUNDRY));
check("Foundry: combatTurnChange called on every client", FOUNDRY.includes('// Hooks handled by all clients\n    Hooks.callAll("combatTurnChange", this, previous, current);'));
check("no Round begun in combatRound any more", !COMBAT.includes('Hooks.on("combatRound"'));
const at = COMBAT.indexOf('Hooks.on("combatTurnChange"');
const body = COMBAT.slice(at, COMBAT.indexOf("\n  });\n", at));
const begun = body.indexOf("if (Number(current?.round) > Number(previous?.round)) await startRound(combat);");
check("begun in the turn change, the GM's, as the Round moves forward", begun > 0 && body.includes("game.users.activeGM !== game.user"));
check("after the last turn's end", begun > body.indexOf('await fireMoment(leaving, "end-of-turn");') && begun > body.indexOf("edgeReached(leaving, EDGES.END)"));
check("before the first turn's beginning, and before a resumed turn returns", begun < body.indexOf("await beginTurn(arriving)") && begun < body.indexOf("const resumed = "));
check("never the first Round - combatStart's", body.indexOf("if (!(Number(previous?.round) > 0)) return;") < begun);
console.log(failed ? `${failed} failing` : "all passing");
process.exit(failed ? 1 : 0);
