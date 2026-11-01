import { isDuplicate } from "./actor-types.mjs";

/**
 * The Duplicate band (the user's design): a Duplicate Minion's token crossed by a gray, half-clear diagonal band reading "DUPLICATE", like a
 * prohibition sign - so the copies are told apart from the one they copy. Drawn on the token itself, clipped to it: it moves and scales with
 * it, everyone sees it, and it goes as the Duplicate box is unticked. Nothing is written on the Actor or the token.
 */
export function registerTokenMarks() {
  Hooks.on("refreshToken", token => drawDuplicateBand(token));
  Hooks.on("destroyToken", token => clearBand(token));
  // The box ticked or unticked on the Minion's Settings: its tokens drawn again.
  Hooks.on("updateActor", (actor, changes) => {
    if (!foundry.utils.hasProperty(changes, "system.duplicate")) return;
    for (const token of actor.getActiveTokens?.(true, false) ?? []) drawDuplicateBand(token);
  });
}

/** The band on a token whose Actor is a Duplicate, at its current size - and none on any other. */
export function drawDuplicateBand(token) {
  if (!token || token.destroyed) return;
  if (!isDuplicate(token.actor)) return clearBand(token);
  const { w, h } = token;
  if (!(w > 0) || !(h > 0)) return;
  const size = `${w}x${h}`;
  const kept = token._dbuDuplicateBand;
  if (kept && !kept.destroyed && (kept._dbuSize === size)) return;
  clearBand(token);

  const band = new PIXI.Container();
  band._dbuSize = size;
  band.eventMode = "none";
  // Its strip: gray at a little over half, thin light edges, rotated -35 degrees through the token's centre - long enough to cross it.
  const thick = Math.max(10, h * 0.19);
  const edge = Math.max(1, thick * 0.055);
  const length = Math.hypot(w, h) * 1.2;
  const strip = new PIXI.Container();
  strip.position.set(w / 2, h / 2);
  strip.rotation = -35 * (Math.PI / 180);
  const fill = new PIXI.Graphics();
  fill.beginFill(0x444441, 0.55).drawRect(-length / 2, -thick / 2, length, thick).endFill();
  fill.beginFill(0xffffff, 0.45).drawRect(-length / 2, -thick / 2, length, edge).drawRect(-length / 2, (thick / 2) - edge, length, edge).endFill();
  strip.addChild(fill);
  const label = new PIXI.Text("DUPLICATE", { fontFamily: "Signika, sans-serif", fontSize: Math.max(8, Math.round(thick * 0.5)),
    fontWeight: "bold", fill: 0xffffff, letterSpacing: Math.round(thick * 0.06) });
  label.alpha = 0.8;
  label.anchor.set(0.5);
  strip.addChild(label);
  band.addChild(strip);
  // Clipped to the token's own square.
  const mask = new PIXI.Graphics();
  mask.beginFill(0xffffff).drawRect(0, 0, w, h).endFill();
  band.addChild(mask);
  band.mask = mask;

  token.addChild(band);
  token._dbuDuplicateBand = band;
}

function clearBand(token) {
  const band = token?._dbuDuplicateBand;
  if (band && !band.destroyed) band.destroy({ children: true });
  if (token) token._dbuDuplicateBand = null;
}
