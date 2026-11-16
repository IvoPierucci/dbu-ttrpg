/**
 * The Metamoran Fusion Dance (a Unique Ability): "Target an Ally within your Melee Range who is of the same Power Level as you and
 * within 1 Size Category of you until the start of your next turn. For each stack of Holding Back a Character possesses, treat their
 * Power Level as if it was 1 lower for this effect. If that Ally also targets you with the Metamoran Fusion Dance, both Characters
 * make a Performance Skill Check with a Difficulty Category of Master. If you are not the same Size Category as your target, increase
 * the Performance Skill Check's Difficulty Category by 1 for both Characters."
 *
 * Used: your targeted token, refused before anything is paid where it may not be (askDance). The one you target kept on you till your
 * next turn begins (combat.mjs beginTurn). Answered - they target you with it while you are on theirs - a card with both Checks, each
 * rolled by whoever plays that Character, self-correcting as any card's (chat.mjs CARD_SETTLERS). At least one made: a Fuse button -
 * the Metamorese Fusion Method; one failed, its 1d4 rolled on the card, Plump (2~4) or Frail (1): a Trait of the Fusion's
 * (traits/other/fusion-dance/), no Fusion Modifiers asked. Five-Way Fusion: four Allies ticked, the Maxi Fusion Method at once.
 * Skill in Fusion: any Character, whatever their Size Category and Power Level.
 */

import DBUCharacterData from "./data/actor-character.mjs";
import { isCharacter, isFusion } from "./actor-types.mjs";
import { areAllies } from "./allies.mjs";
import { getTrait } from "./effects/traits.mjs";
import { partnerOf } from "./effects/conditions.mjs";

const SCOPE = "dbu-ttrpg";

/** On a dancer: whom they target with it, till the start of their next turn - { uuid, name }. */
export const DANCE_TARGET = "fusionDance";

/** On the card both Checks are made on: who, and at which Difficulty - and, once rolled, its 1d4 and the Fusion made. */
export const DANCE_CARD = "fusionDanceCard";

/** Each side's Check, settled: { done: { success, total } } - a flag each, so each self-corrects on its own (chat.mjs resettleCheck). */
export const DANCE_SIDE = Object.freeze({ a: "fusionDanceA", b: "fusionDanceB" });

/** What a Fusion of it gone wrong becomes, and its Trait's file. */
export const DANCE_TRAITS = Object.freeze({ plump: "plump-fusion", frail: "frail-fusion" });

const SIZE_ORDER = Object.keys(DBUCharacterData.SIZES);
const DIFFICULTY_ORDER = Object.keys(DBUCharacterData.DIFFICULTIES);

/** "For each stack of Holding Back a Character possesses, treat their Power Level as if it was 1 lower for this effect." */
export function dancePowerLevel(actor) {
  return (Number(actor?.system?.powerLevel) || 1) - (Number(actor?.system?.resources?.holdingback?.stacks) || 0);
}

function sizeAt(actor) {
  const at = SIZE_ORDER.indexOf(actor?.system?.size?.key ?? DBUCharacterData.DEFAULT_SIZE);
  return (at < 0) ? SIZE_ORDER.indexOf(DBUCharacterData.DEFAULT_SIZE) : at;
}

/**
 * Why this one may not be danced with, or null. A Fusion never ("A Fusion cannot be a Fused Character for another Fusion"); an Ally in
 * your Melee Range, at your Power Level and within 1 Size Category - with Skill in Fusion (`anyone`), any Character in it.
 */
export function whyNotDance(actor, target, { anyone = false, melee = () => null, name = "Metamoran Fusion Dance" } = {}) {
  if (!target) return `${name}: target the ${anyone ? "Character" : "Ally"} to dance with first.`;
  if (isFusion(actor) || isFusion(target)) return "A Fusion cannot be a Fused Character for another Fusion.";
  if (!isCharacter(target)) return `${name}: ${target.name} is not a Character.`;
  if (!anyone && !areAllies(actor, target)) return `${name}: ${target.name} is not your Ally.`;
  const far = melee(actor, target, name);
  if (far) return far;
  if (anyone) return null;
  if (dancePowerLevel(actor) !== dancePowerLevel(target)) {
    return `${name}: ${target.name}'s Power Level is not yours (${dancePowerLevel(target)} and ${dancePowerLevel(actor)}, Holding Back's stacks counted).`;
  }
  if (Math.abs(sizeAt(actor) - sizeAt(target)) > 1) return `${name}: ${target.name} is more than 1 Size Category from you.`;
  return null;
}

/**
 * This dancer's Difficulty: Master - Superior Synchronization (1)'s Expert, "if the Character you are attempting to fuse with is your
 * Partner" - one more where the two are not the same Size Category.
 */
export function danceDifficulty(actor, target, partner = partnerOf) {
  const expert = (actor?.system?.effects?.slots?.["sync.danceExpert"] === true) && Boolean(target)
    && (partner(actor)?.id === target.id);
  const at = DIFFICULTY_ORDER.indexOf(expert ? "expert" : "master") + ((sizeAt(actor) !== sizeAt(target)) ? 1 : 0);
  return DIFFICULTY_ORDER[Math.min(DIFFICULTY_ORDER.length - 1, at)];
}

/** What both Checks make: "both" made, "one" made, "none" - or "" while one is still to roll. */
export function danceOutcome(a, b) {
  if (!a || !b) return "";
  if (a.success && b.success) return "both";
  return (a.success || b.success) ? "one" : "none";
}

/** "If the result is 2~4 the Fusion becomes Plump, and if your result is a 1, the Fusion becomes Frail." */
export function danceMishap(d4) {
  return (Number(d4) === 1) ? "frail" : "plump";
}

/**
 * Whom, before anything is paid: your one targeted token - or, with Five-Way Fusion, "4 Allies instead ... within a Large Sphere AoE
 * (centered on you)", ticked (who is within it the table's). Null where it was dropped or may not be.
 */
export async function askDance(actor, maneuver) {
  const unique = actor.items?.get(maneuver.itemId)?.system?.unique;
  if (!unique) return null;
  if (isFusion(actor)) return void ui.notifications.warn("A Fusion cannot be a Fused Character for another Fusion.") ?? null;
  const { boughtTraits } = await import("./unique.mjs");
  const bought = boughtTraits(unique, getTrait);
  const five = bought.find(trait => trait.danceFive) ?? null;
  const anyone = bought.some(trait => trait.danceAnyone);
  const { whyNotWithinMelee } = await import("./maneuvers.mjs");
  const targeted = [...new Map(Array.from(game.user.targets ?? []).map(token => token.actor)
    .filter(other => other && (other.uuid !== actor.uuid)).map(other => [other.uuid, other])).values()];
  const one = (targeted.length === 1) ? targeted[0] : null;
  const single = () => {
    const why = (targeted.length > 1) ? `${maneuver.name}: target one ${anyone ? "Character" : "Ally"}.`
      : whyNotDance(actor, one, { anyone, melee: whyNotWithinMelee, name: maneuver.name });
    if (why) return void ui.notifications.warn(why) ?? null;
    return { mode: "one", targetUuid: one.uuid };
  };
  if (!five) return single();

  const pool = [...new Map((globalThis.canvas?.tokens?.placeables ?? []).map(token => token.actor)
    .filter(other => other && isCharacter(other) && !isFusion(other) && (other.uuid !== actor.uuid) && areAllies(actor, other))
    .map(other => [other.uuid, other])).values()].sort((x, y) => x.name.localeCompare(y.name));
  const escape = foundry.utils.escapeHTML;
  const ticked = new Set(targeted.map(other => other.uuid));
  const chosen = await foundry.applications.api.DialogV2.wait({
    classes: ["dbu-dialog"],
    window: { title: `${actor.name} - ${maneuver.name}` },
    content: `<label class="dbu-wager"><span>Dance with</span><select name="mode">
        ${one ? `<option value="one">${escape(one.name)}</option>` : ""}
        <option value="five" ${one ? "" : "selected"}>${escape(five.name)}: 4 Allies in a Large Sphere</option></select></label>
      <p class="dbu-respond-hint">${escape(five.name)}: 4 Allies within a Large Sphere around you - the Maxi Fusion Method at once</p>
      ${pool.map(other => `<label class="dbu-respond-option"><input type="checkbox" name="${escape(other.uuid)}" ${ticked.has(other.uuid) ? "checked" : ""}/>
        <span class="dbu-respond-name">${escape(other.name)}</span></label>`).join("") || "<p>No Ally on the scene.</p>"}`,
    buttons: [
      { action: "dance", label: "Dance", default: true, callback: (event, button, dialog) => ({
        mode: dialog.element.querySelector('select[name="mode"]')?.value ?? "five",
        uuids: pool.filter(other => dialog.element.querySelector(`input[name="${CSS.escape(other.uuid)}"]`)?.checked).map(other => other.uuid) }) },
      { action: "cancel", label: "Cancel" }
    ],
    rejectClose: false
  }).catch(() => null);
  if (!chosen || (typeof chosen !== "object")) return null;
  if (chosen.mode === "one") return single();
  if (chosen.uuids.length !== 4) return void ui.notifications.warn(`${five.name}: 4 Allies - ${chosen.uuids.length} ticked.`) ?? null;
  return { mode: "five", uuids: chosen.uuids };
}

/**
 * Used. Five-Way Fusion: the five fused at once. Otherwise, the one targeted kept on you - and, where they target you with it already,
 * the card both Checks are made on, yours rolled now.
 */
export async function postDance(actor, maneuver, plan) {
  const escape = foundry.utils.escapeHTML;
  const speaker = ChatMessage.getSpeaker({ actor });
  if (plan.mode === "five") {
    const others = plan.uuids.map(uuid => fromUuidSync(uuid)).filter(Boolean);
    const message = await ChatMessage.create({ speaker, content: `<p>${escape(maneuver.name)}</p><div class="dbu-settled-note">Five-Way Fusion: ${
      escape([actor, ...others].map(each => each.name).join(", "))} combine - the Maxi Fusion Method.</div>` });
    const { fuseTogether } = await import("./fusion-make.mjs");
    await fuseTogether([actor, ...others], "maxi");
    return message;
  }
  const target = fromUuidSync(plan.targetUuid);
  if (!target) return null;
  const theirs = target.getFlag?.(SCOPE, DANCE_TARGET);
  if (theirs?.uuid !== actor.uuid) {
    await actor.setFlag(SCOPE, DANCE_TARGET, { uuid: target.uuid, name: target.name });
    return ChatMessage.create({ speaker, content: `<p>${escape(maneuver.name)}</p><div class="dbu-settled-note">${escape(actor.name)} dances with ${
      escape(target.name)}: answered with the Metamoran Fusion Dance before ${escape(actor.name)}'s next turn, both make a Performance Check.</div>` });
  }
  // Answered: neither is waiting any more.
  const { requestActorUpdate } = await import("./chat.mjs");
  await requestActorUpdate(target, { [`flags.${SCOPE}.${DANCE_TARGET}`]: null });
  if (actor.getFlag?.(SCOPE, DANCE_TARGET)) await actor.setFlag(SCOPE, DANCE_TARGET, null);
  const card = { a: target.uuid, aName: target.name, b: actor.uuid, bName: actor.name,
    dc: { a: danceDifficulty(target, actor), b: danceDifficulty(actor, target) }, d4: 0, fused: "" };
  const message = await ChatMessage.create({ speaker, content: `<p>${escape(maneuver.name)}: ${escape(target.name)} and ${escape(actor.name)}</p>`,
    flags: { [SCOPE]: { [DANCE_CARD]: card } } });
  // Your own Check now; theirs from the card, by whoever plays them.
  await danceRoll(message, "b");
  return message;
}

/** One side's Performance Check, rolled by whoever plays them: closed without rolling, the card's Roll button stays. */
export async function danceRoll(message, side) {
  const card = message?.getFlag?.(SCOPE, DANCE_CARD);
  const dancer = card ? fromUuidSync(card[side]) : null;
  if (!dancer?.sheet || !dancer.isOwner) return;
  const against = card.dc[side];
  const total = await dancer.sheet.rollSkillAgainst("performance", against,
    { settles: { kind: (side === "a") ? "danceA" : "danceB", messageId: message.id } });
  if (typeof total !== "number") return;
  return settleDanceSide(message, side, total >= (DBUCharacterData.DIFFICULTIES[against]?.tn ?? Infinity), total);
}

/** Written on the card - by whoever may, else the GM (chat.mjs requestEdit). */
export async function settleDanceSide(message, side, success, total) {
  const { requestEdit } = await import("./chat.mjs");
  return requestEdit(message, { type: "fusionDance", flag: DANCE_SIDE[side], value: { done: { success: Boolean(success), total } } });
}

/** Each card's 1d4, once rolled on this client. */
const ROLLED_D4 = new Map();

/**
 * Fuse: "Both Characters combine using the Metamorese Fusion Method" - with one failed, "roll a 1d4": rolled here once, on the card,
 * and kept. Asked as any Fuse is (fusion-make.mjs fuseTogether) - but no Fusion Modifiers for a Plump or Frail one.
 */
export async function danceFuse(message) {
  const card = message?.getFlag?.(SCOPE, DANCE_CARD);
  const a = message?.getFlag?.(SCOPE, DANCE_SIDE.a)?.done;
  const b = message?.getFlag?.(SCOPE, DANCE_SIDE.b)?.done;
  const outcome = danceOutcome(a, b);
  if (!card || card.fused || !["both", "one"].includes(outcome)) return;
  const actors = [fromUuidSync(card.a), fromUuidSync(card.b)];
  if (actors.some(each => !each)) return ui.notifications.warn("One of them is no longer here to fuse with.");
  const { requestEdit } = await import("./chat.mjs");
  // Rolled once: kept here too, a second click coming before a relayed write reaches the card.
  let d4 = Number(card.d4) || ROLLED_D4.get(message.id) || 0;
  if ((outcome === "one") && !d4) {
    d4 = (await new Roll("1d4").evaluate()).total;
    ROLLED_D4.set(message.id, d4);
    await requestEdit(message, { type: "fusionDance", flag: DANCE_CARD, value: { ...card, d4 } });
  }
  const { fuseTogether } = await import("./fusion-make.mjs");
  const made = await fuseTogether(actors, "metamorese", { dance: (outcome === "one") ? danceMishap(d4) : "" });
  // Made - or asked of the GM, who makes it; dropped or refused, the button stays.
  if ((made?.documentName === "Actor") || made?.requested) {
    await requestEdit(message, { type: "fusionDance", flag: DANCE_CARD, value: { ...card, d4, fused: made.name || "fused" } });
  }
  return made;
}
