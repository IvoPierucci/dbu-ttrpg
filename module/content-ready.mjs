/**
 * Whether the system's content - its Traits, Races and Maneuvers, read from their files as the world is set up - is loaded, and
 * every character prepared with it.
 *
 * Foundry does not wait on an async `setup` hook: the world opens, and a sheet can be opened, while the files are still being read.
 * Opened then, it was drawn without them and stayed so until reopened (the user's, 2026-11-27). A sheet now waits on this before it
 * is drawn (`waitForContent`), and says so. No Foundry document is touched here.
 */

let loading = null;
let ready = false;

/** Set by the `setup` hook: the loading under way. Ready once it settles, whether or not a file failed. */
export function contentLoading(promise) {
  loading = Promise.resolve(promise).finally(() => { ready = true; });
  return loading;
}

/** Whether it is done. */
export function contentReady() {
  return ready;
}

/**
 * Wait for it, saying so once in a notification the first time a sheet has to - "DBU TTRPG: loading the rules...". At once where
 * it is done, or where nothing is loading (a harness, a test).
 */
export async function waitForContent() {
  if (ready || !loading) return;
  if (!waitForContent.said) {
    waitForContent.said = true;
    globalThis.ui?.notifications?.info("DBU TTRPG: loading the rules... The sheet opens as soon as they are ready.");
  }
  await loading;
}
