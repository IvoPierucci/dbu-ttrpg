/**
 * Fusing (the Fusion page's Character Combination and Repeating Fusions): a Fusion made, or made again, from its Fused Characters.
 * Built in its own stage; till then, said.
 */

/** Fuse, or Fuse again (recalculate), from a Fusion's tab. */
export async function fuseOnto(fusion) {
  globalThis.ui?.notifications?.info(`${fusion?.name ?? "The Fusion"}: fusing is not built yet.`);
  return null;
}
