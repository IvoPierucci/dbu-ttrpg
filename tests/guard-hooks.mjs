let main = "";
let folder = "";
let port = null;

export async function initialize({ main: entry, self, port: channel }) {
  main = entry.toLowerCase();
  folder = new URL(".", self).href.toLowerCase();
  port = channel;
}

export async function resolve(specifier, context, next) {
  const found = await next(specifier, context);
  const url = String(found.url).toLowerCase();
  const own = url.startsWith(folder) && (url !== main) && url.endsWith(".mjs")
    && !url.endsWith("/guard.mjs") && !url.endsWith("/guard-hooks.mjs");
  if (own) {
    port?.postMessage(found.url);
    throw new Error(`A harness loaded another harness: ${found.url}`);
  }
  return found;
}
