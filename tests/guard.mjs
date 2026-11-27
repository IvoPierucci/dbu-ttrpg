/**
 * Loaded before every harness: no harness may load another.
 *
 * Code cut out of a module and run inside a harness resolves its relative imports against the
 * harness's folder - and "./gear.mjs" there is the gear harness. Loaded, it ran its own checks
 * and its process.exit ended the harness that loaded it halfway through, with a 0: the
 * environments harness stopped a third of the way in, for weeks, and the battery said it
 * passed. Any file of this folder but the harness itself is refused - and said, and failed,
 * even where the code that asked for it swallows the error.
 */
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { MessageChannel } from "node:worker_threads";

const { port1, port2 } = new MessageChannel();
const loaded = [];
port1.on("message", url => {
  loaded.push(url);
  console.log(`FAIL  a harness loaded another harness: ${url}`);
});
port1.unref();

process.on("exit", code => {
  if (loaded.length && !code) process.exitCode = 1;
});

register("./guard-hooks.mjs", import.meta.url, {
  data: { main: pathToFileURL(process.argv[1] ?? "").href, self: import.meta.url, port: port2 },
  transferList: [port2]
});
