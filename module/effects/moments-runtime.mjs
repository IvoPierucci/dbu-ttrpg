/**
 * Making a Moment happen.
 *
 * A passive is folded into derived data and recomputed forever; a reactive effect
 * *occurs*. It changes what a character has, once, and that has to be written down. So
 * this is the half of the engine that touches the world, and it is deliberately the only
 * part that does - the interpreter stays a pure function of the character's data, which
 * is what makes it checkable and what keeps `prepareDerivedData` free of side effects.
 *
 * An Automatic effect fires on its own and says so in chat, because a number moving with
 * no explanation is worse than no automation at all. A Triggered one only fires if it was
 * armed beforehand, which is the player's decision and belongs to the roll dialog.
 */

import { reactiveFor } from "./registry.mjs";
import { collectReactive, applySlot } from "./interpreter.mjs";
import { getTrait, resourceLimits } from "./traits.mjs";
import { getMoment } from "./moments.mjs";

/**
 * Slots that name something stored rather than something derived.
 *
 * A passive writing to `life.max` is recomputed from nothing every time the sheet is
 * prepared. A reactive effect taking Life Points away has to actually take them, or the
 * next preparation puts them straight back.
 */
const STATEFUL = {
  // Regained never past the most there may be - Skill of the Watcher's 2(bT) a Counter Action.
  "life.value": { path: "system.life.value", read: a => a.system.life.value, cap: a => a.system.life.max },
  "ki.value": { path: "system.ki.value", read: a => a.system.ki.value, cap: a => a.system.ki.max },
  "divineKi.value": { path: "system.divineKi.value", read: a => Number(a.system.divineKi?.value) || 0,
    cap: a => Number(a.system.divineKi?.max) || 0 },
  // Counter Actions turned into Actions this Round - Celestial Potential's.
  "actions.fromCounter": { path: "system.actionsSpent.fromCounter",
    read: a => Number(a.system.actionsSpent?.fromCounter) || 0 },
  // Counter Actions gained this Round, held as the converted ones are - the Round's own allowance is the rest.
  "actions.counterGained": { path: "system.actionsSpent.converted",
    read: a => Number(a.system.actionsSpent?.converted) || 0 },
  // Counter Actions spent this Round - Divine Physique's Superior.
  "actions.counterSpent": { path: "system.actionsSpent.counter",
    read: a => Number(a.system.actionsSpent?.counter) || 0 },
  "capacity.spent": { path: "system.capacity.spent", read: a => a.system.capacity.spent },

  // Actions left, which is not a number the character holds: what is held is how many
  // were spent, and what is left is the round's own allowance less that. So this one
  // reads forwards and writes backwards - an effect that hands you an Action is an
  // effect that unspends one, and an effect that takes them all away has spent them.
  //
  // It was declared and written by nobody, which made "you lose all of your Actions" a
  // line that compiled and did nothing.
  "actions.remaining": {
    path: "system.actionsSpent.standard",
    read: a => Math.max(0, (a.system.actions?.standard ?? 0) - (a.system.actionsSpent?.standard ?? 0)),
    write: (a, left) => Math.max(0, (a.system.actions?.standard ?? 0) - left)
  }
};

/**
 * Fire one Moment for one character.
 *
 * @param {Actor} actor
 * @param {string} moment   a key from moments.mjs, parameter and all
 * @param {object} context  what this Moment puts within reach
 * @returns {Promise<{slots: object, fired: number}>} what was collected, and how many
 *   effects answered. The count matters on its own: an effect whose whole body is a
 *   verb - Prone standing you up - changes no Slot at all, and judging it by the Slots
 *   alone reads as nothing having happened.
 */
export async function fireMoment(actor, moment, context = {}, { only = null, stacks = null, quiet = false, blocks = null } = {}) {
  if (!actor) return {};

  const nothing = { slots: {}, fired: 0 };

  const definition = getMoment(moment);
  if (!definition) {
    console.warn(`DBU TTRPG | Nothing in this system knows the moment "${moment}".`);
    return nothing;
  }

  // A Moment can carry a limit of its own, which belongs to the trigger rather than to
  // any effect using it: Threshold fires once per Threshold per Encounter however many
  // effects are waiting on it.
  if (definition.limit && !momentAvailable(actor, definition, context)) return nothing;

  let entries = spectatorHeld(actor, moment, reactiveFor(actor).filter(entry => entry.available && entry.armed));

  // `on applied` is about the thing being applied, not about everything the character
  // happens to be carrying, so a Moment can be narrowed to one source.
  if (only) entries = entries.filter(entry => entry.sourceId === only);

  // Answering a Moment that has already happened - what was ticked on its card: those blocks alone, and nothing that
  // answered it by itself the first time (Born for Battle's Battle Born at an even Round, gained once). What only comes
  // into reach as they run - a State they enter - still answers.
  const answered = blocks ? new Set(entries.filter(entry => !blocks.includes(entry.blockId)).map(entry => entry.blockId)) : null;
  if (blocks) entries = entries.filter(entry => blocks.includes(entry.blockId));

  // And how many stacks it is about can differ from how many are held: what an effect
  // does on being applied is done for the stacks just gained.
  if (stacks !== null) entries = entries.map(entry => ({ ...entry, stacks }));

  if (!entries.length) return nothing;

  // Two passes, and the order between them is a rule rather than a convenience: what the
  // player chose happens first, and only then is what fires by itself looked at.
  //
  // The Spectator State is what asks for it. Its second effect is the player's - leave
  // the State - and its third is automatic and reads "if you did not use the second
  // effect". Collected together, the third was gathered up before the second had run and
  // fired whatever the player did; and since using the second leaves the State, the
  // third is a Spectator effect on somebody who is no longer a Spectator.
  //
  // So the character is re-read between the two. Anything the first pass did - a State
  // left, a Condition gone, a number changed - is true before the second pass decides
  // whether it applies at all.
  const chosen = await runPass(actor, moment, definition, entries, context, "triggered", quiet);
  const byItself = await runPass(actor, moment, definition,
    reactiveAgain(actor, entries, { only, stacks, answered, moment }), context, "automatic", quiet);

  const fired = chosen.fired + byItself.fired;
  if (!fired) return nothing;

  return { slots: { ...chosen.slots, ...byItself.slots }, fired };
}

/**
 * The same list, read off the character again.
 *
 * The first pass can have changed what the second is even looking at - left a State,
 * taken a Condition off - and an entry list gathered before that is a list of things
 * that were true a moment ago.
 */
/**
 * Spectator (5): "You cannot trigger any [Triggered/Start of Turn] or [Triggered/Start of Combat Round] effects, except those
 * from the Spectator State." Those left out while it is had - Automatic or not, a Triggered effect is still one.
 */
export function spectatorHeld(actor, moment, entries) {
  if (!["start-of-turn", "start-of-round"].includes(String(moment))) return entries;
  if (!((Number(actor?.system?.states?.spectator) || 0) > 0)) return entries;
  return entries.filter(entry => (entry.sourceId === "state:spectator")
    || (String(entry.program?.blocks?.[0]?.mode ?? "") !== "triggered"));
}

function reactiveAgain(actor, before, { only = null, stacks = null, answered = null, moment = "" }) {
  let entries = spectatorHeld(actor, moment, reactiveFor(actor).filter(entry => entry.available && entry.armed));
  if (only) entries = entries.filter(entry => entry.sourceId === only);
  if (answered) entries = entries.filter(entry => !answered.has(entry.blockId));
  if (stacks !== null) entries = entries.map(entry => ({ ...entry, stacks }));
  return entries;
}

/** One half of a Moment: everything of one kind that answers it. */
async function runPass(actor, moment, definition, entries, context, mode, quiet = false) {
  const nothing = { slots: {}, fired: 0 };
  if (!entries.length) return nothing;

  const scope = { data: actor.system, errors: [], context, queue: [] };
  const { slots, spent } = collectReactive(entries, moment, scope, { mode });

  for (const message of scope.errors) {
    console.warn(`DBU TTRPG | ${actor.name}: ${message}`);
  }
  if (!spent.length) return nothing;

  await writeStateful(actor, slots);
  // A verb that did nothing because the player chose nothing - Patient Sniper's "None" - leaves its use unspent.
  const declined = new Set();
  for (const call of scope.queue) {
    if ((await runVerb(actor, call, context)) === UNSPENT) declined.add(call.verb);
  }
  const counted = declined.size ? spent.filter(use => !callsAny(entries, use, declined)) : spent;

  await recordUses(actor, counted, definition, context, spent);
  // Quiet where the caller says what it did on a card of its own - a Maneuver's Life and Ki, by source (chat.mjs gainsHtml).
  if (!quiet) await announce(actor, entries, spent, moment);

  return { slots, fired: spent.length };
}

/**
 * A Slot named "<name>.stacks" is how an effect raises or lowers a Resource.
 *
 * The only Slot pattern that ends that way, and the only thing that ever put a Resource
 * on a character - which it did not do, until it did.
 */
const RESOURCE_STACKS = /^(\w+)\.stacks$/;

/**
 * What the Moment did to the Resources, as one update to the bag that holds them.
 *
 * Written whole with a ForcedReplacement, because that is the only way a removal sticks
 * on an ObjectField: merged in the ordinary way, a key that has gone is a key that was
 * simply not mentioned, and it stays.
 *
 * A Resource at nothing is removed rather than left at zero. `hasResource` asks whether
 * the character has one at all, and a duration takes one away by deleting its key - so a
 * zero left lying about is a Resource that is still there as far as both are concerned.
 */
function resourceUpdates(actor, slots) {
  const names = Object.keys(slots)
    .map(key => RESOURCE_STACKS.exec(key))
    .filter(Boolean)
    .map(match => match[1]);
  if (!names.length) return null;

  const limits = resourceLimits(actor);
  const held = { ...(actor.system.resources ?? {}) };
  let changed = false;

  for (const name of names) {
    const current = held[name]?.stacks ?? 0;
    // The declared ceiling, or none at all where the Trait declares no maximum: a
    // Resource nobody bounded is unbounded, not bounded at zero.
    const max = limits[name] ?? held[name]?.max ?? 0;
    const raw = Math.round(applySlot(slots, `${name}.stacks`, current));
    const stacks = Math.max(0, max ? Math.min(raw, max) : raw);

    if (stacks === current) continue;
    changed = true;

    if (stacks > 0) held[name] = { stacks, max };
    else delete held[name];
  }

  return changed ? held : null;
}

/** Put what the Moment changed onto the character. */
async function writeStateful(actor, slots) {
  const updates = {};

  // Resources first, since the rest of this is one update and this is part of it.
  const resources = resourceUpdates(actor, slots);
  // Gained, where that is a Moment of its own - Comfort's - answered once written.
  const gained = resources ? GAINED_MOMENTS.filter(name =>
    (Number(resources[name]?.stacks) || 0) > (Number(actor.system.resources?.[name]?.stacks) || 0)) : [];
  // How many of each, read before they are written.
  const counts = Object.fromEntries(gained.map(name => [name,
    (Number(resources[name]?.stacks) || 0) - (Number(actor.system.resources?.[name]?.stacks) || 0)]));
  if (resources) {
    // Reached dynamically, like every other call from here into conditions.mjs: that
    // module imports fireMoment from this one, and a static import back closes the
    // circle.
    const { replaceObject } = await import("../conditions.mjs");
    updates["system.resources"] = replaceObject(resources);
    // A Resource gone to nothing takes its clocks with it - Greed of the Hera's Power, lost at the start of the turn: a
    // clock left behind would take a stack gained later off before its own time.
    const gone = Object.keys(actor.system.resources ?? {}).filter(name => !resources[name]);
    const timed = actor.system.timed ?? [];
    if (gone.length && timed.some(entry => (entry.kind === "resource") && gone.includes(entry.key))) {
      updates["system.timed"] = timed.filter(entry => !((entry.kind === "resource") && gone.includes(entry.key)));
    }
  }

  for (const [key, { path, read, write, cap }] of Object.entries(STATEFUL)) {
    if (!(key in slots)) continue;

    const before = read(actor);
    let raised = applySlot(slots, key, before);
    // Superior Durability (2): "Halve the amount of Life Points you would lose from the effects of a Combat Condition,
    // Environmental Qualities, or Damage Over Time" - what those took, half of it given back (the loss rounded down).
    if ((key === "life.value") && (actor.system.effects?.slots?.["life.lossHalved"] === true)) {
      const lost = -(slots[key]?.parts ?? []).filter(part => (part.op === "add") && (Number(part.value) < 0)
        && /^(condition|quality|battlefield|high):/.test(part.sourceId ?? "")).reduce((sum, part) => sum + Number(part.value), 0);
      if (lost > 0) raised += lost - Math.floor(lost / 2);
    }
    // Dead (2): what your own effects take - not a Condition's, a Quality's, the Battlefield's - halved, rounded down.
    if ((key === "life.value") && (actor.system.effects?.slots?.["life.ownLossHalved"] === true)) {
      const own = -(slots[key]?.parts ?? []).filter(part => (part.op === "add") && (Number(part.value) < 0)
        && !/^(condition|quality|battlefield|high):/.test(part.sourceId ?? "")).reduce((sum, part) => sum + Number(part.value), 0);
      if (own > 0) raised += own - Math.floor(own / 2);
    }
    // Undead Survival (3): "While you are in the Undying State, you cannot regain Life Points through the effects of any of your
    // Traits" - what your own effects add, left off; a Condition's, a Quality's, the Battlefield's are not yours.
    if ((key === "life.value") && (actor.system.effects?.slots?.["undead.noTraitHealing"] === true)
      && ((Number(actor.system.states?.undying) || 0) > 0)) {
      const healed = (slots[key]?.parts ?? []).filter(part => (part.op === "add") && (Number(part.value) > 0)
        && !/^(condition|quality|battlefield|high):/.test(part.sourceId ?? "")).reduce((sum, part) => sum + Number(part.value), 0);
      if (healed > 0) raised -= healed;
    }
    // Raised no further than the most there may be; what was already above it is left.
    const settled = (cap && (raised > before)) ? Math.min(raised, Math.max(before, cap(actor))) : raised;
    if (write) {
      updates[path] = Math.max(0, Math.round(write(actor, settled)));
      continue;
    }
    // Life Points are the one value with a stated exception to the floor, and even that
    // has to be granted by something - the Undying State.
    const negative = (key === "life.value")
      && !!actor.system.effects?.slots?.["life.allowNegative"];
    // Survivor's least, below nothing - and its (7): "If one of your effects would ... set your amount of Life Points to 1
    // while your Life Points are below 0, instead set your Life Points to 1 above your lowest possible amount" - Undying's.
    const least = (key === "life.value") ? Math.min(0, Number(actor.system.life?.min) || 0) : 0;
    let value = Math.round(settled);
    if (least && (before < 0) && (slots[key]?.set === 1)) value = least + 1;
    updates[path] = negative ? value : Math.max(least, value);
  }

  if (!foundry.utils.isEmpty(updates)) await actor.update(updates);
  if (gained.length) await stacksGained(actor, gained, counts);
}

/**
 * Verbs act on the world, which is why the interpreter only queues them.
 *
 * Adding one costs a case here and a line in the author's guide, and nothing else.
 */
/**
 * Stacks of these Resources just gained: Battle Born's - on any of its three Combat Rolls - is a Moment (`battle-born`),
 * what is the player's asked in a window first (Primitive Durability's "If you gain a stack of Battle Born").
 */
export async function stacksGained(actor, names, counts = {}) {
  const { offerTriggers } = await import("../chat.mjs");
  // Overwhelm's - Redirected Energy's "Upon gaining a stack of Overwhelm" - and Demonic Power's - Demons of the Makyo
  // Star's - with how many.
  // And Power's - Greed of the Hera's "Each time you gain a stack(s) of Power".
  for (const [name, moment] of [["overwhelm", "overwhelm-gained"], ["demonicpower", "demonic-power-gained"],
    ["power", "power-gained"], ["negativeenergy", "negative-energy-gained"], ["sunlight", "sunlight-gained"]]) {
    if (!names.includes(name)) continue;
    const context = { gained: Math.max(1, Number(counts[name]) || 1) };
    await offerTriggers(actor, moment, context);
    await fireMoment(actor, moment, context);
  }
  // Comfort's - Comfortable Count's "If you gain a stack of Comfort".
  if (names.includes("comfort")) {
    await offerTriggers(actor, "comfort-gained");
    await fireMoment(actor, "comfort-gained");
  }
  if (!names.some(name => String(name).startsWith("battleborn"))) return;
  await offerTriggers(actor, "battle-born");
  return fireMoment(actor, "battle-born");
}

/** The Resources whose stacks gained are a Moment where an effect writes them - Comfort's. */
const GAINED_MOMENTS = Object.freeze(["comfort", "overwhelm", "demonicpower", "power", "negativeenergy", "sunlight"]);

/** A character an effect named, by uuid or by name, or nothing. */
function named(who) {
  if (!who) return null;
  return fromUuidSync(String(who))
    ?? game.actors?.find(a => a.name === String(who))
    ?? null;
}

async function runVerb(actor, call, context) {
  const verb = call?.verb;
  const args = call?.args ?? [];

  switch (verb) {
    case "remove":
      return removeCondition(actor, args[0] ?? context.condition);

    case "gain":
      return gainCondition(actor, args[0], args[1] ?? 1);

    case "steadfastEnter": {
      // A Steadfast Check with this added to its Dice Score; made, the State, for the duration.
      const { die, bonus = 0, target, natural = 0 } = actor.system.steadfast ?? {};
      const modifier = Number(args[0]) || 0;
      const roll = await new Roll([die, natural ? `${natural}` : "", bonus ? `${bonus}` : "", modifier ? `${modifier}` : ""]
        .filter(Boolean).join(" + ").replace("+ -", "- ")).evaluate();
      // Failed, what may pass it instead is asked first (chat.mjs rescueSteadfast) - Primitive Durability's.
      const { rescueSteadfast, steadfastCheckFlag } = await import("../chat.mjs");
      const rescued = (roll.total >= target) ? "" : await rescueSteadfast(actor, roll.total, target);
      const passed = (roll.total >= target) || Boolean(rescued);
      // Its die on the card, for what may change it after - turned round, the State entered or left with it.
      const base = `Steadfast Check - needing ${target}`;
      await roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor }),
        flavor: `${base} - ${rescued ? `failed, passed by ${rescued}` : (passed ? "passed" : "failed")}`,
        flags: { "dbu-ttrpg": { check: steadfastCheckFlag(actor, roll, natural,
          { target, base, passed, ...((args[1] && (String(args[1]) !== "life")) ? { enter: [String(args[1]), args[2] ?? null] } : {}) }) } } });
      // Dormant Saiya Power (2): "If you succeed, set your Life Points to 1."
      if (passed && (String(args[1]) === "life")) return actor.update({ "system.life.value": 1 });
      if (passed && args[1]) return enterState(actor, args[1], 1, args[2] ?? null);
      return;
    }

    case "reduceOpponentLife": {
      const opponent = context?.opponentUuid ? fromUuidSync(context.opponentUuid) : null;
      const amount = Number(actor.system.attributes?.[String(args[0] ?? "")]?.mod) || 0;
      if (!opponent || (amount <= 0)) return;
      const { reduceLifePoints } = await import("../chat.mjs");
      return reduceLifePoints(opponent, amount, { reason: actor.name });
    }

    case "legendRealized": {
      const { legendRealized } = await import("../chat.mjs");
      return legendRealized(actor);
    }

    case "kiForLife": {
      const { kiForLife } = await import("../chat.mjs");
      return kiForLife(actor);
    }

    case "comfortForOverwhelm": {
      const { comfortForOverwhelm } = await import("../chat.mjs");
      return comfortForOverwhelm(actor);
    }

    case "rulerAllies": {
      const { rulerAllies } = await import("../chat.mjs");
      return rulerAllies(actor);
    }

    case "shardCarriers": {
      const { shardCarriers } = await import("../chat.mjs");
      return shardCarriers(actor, context?.struck ?? []);
    }

    case "shardStrike": {
      const { shardStrike } = await import("../chat.mjs");
      return shardStrike(actor);
    }

    case "shardBurst": {
      const { shardBurst } = await import("../chat.mjs");
      return shardBurst(actor);
    }

    case "debuff": return (await import("../chat.mjs")).debuff(actor);
    case "lifeBurn": return (await import("../chat.mjs")).lifeBurn(actor);
    case "namekianTechnique": return (await import("../chat.mjs")).namekianTechnique(actor);
    case "studyCharacter": return (await import("../chat.mjs")).studyCharacter(actor);
    case "spectatorCheer": return (await import("../chat.mjs")).spectatorCheer(actor);
    case "spectatorLeft": return (await import("../chat.mjs")).spectatorLeft(actor);
    case "motivatingPerformance": return (await import("../chat.mjs")).motivatingPerformance(actor);
    case "motivatedLeft": return (await import("../chat.mjs")).motivatedLeft(actor);
    case "dynamicHypeEnds": return (await import("../chat.mjs")).dynamicHypeEnds(actor);
    case "juryRig": return (await import("../chat.mjs")).juryRig(actor);
    case "lightningPower": return (await import("../chat.mjs")).lightningPower(actor);
    case "lionsHeart": return (await import("../chat.mjs")).lionsHeart(actor);
    case "adamantineStrike": return (await import("../chat.mjs")).adamantineStrike(actor);
    case "allOutTransform": return (await import("../chat.mjs")).allOutTransform(actor);
    case "allOutStart": return (await import("../chat.mjs")).allOutStart(actor);
    case "jumpStartPower": return (await import("../chat.mjs")).jumpStartPower(actor);
    case "jumpStart": return (await import("../chat.mjs")).jumpStart(actor);
    case "warmUpPower": return (await import("../chat.mjs")).warmUpPower(actor);
    case "slowStarter": return (await import("../chat.mjs")).slowStarter(actor);
    case "instantCraft": return (await import("../chat.mjs")).instantCraft(actor);
    case "teamBrace": return (await import("../chat.mjs")).teamBrace(actor);
    case "terrifyingPresence": return (await import("../chat.mjs")).terrifyingPresence(actor);
    case "mentalWarfare": return (await import("../chat.mjs")).mentalWarfare(actor, context?.knockedUuid);
    case "opportunist": return (await import("../chat.mjs")).opportunist(actor, context?.knockedUuid);
    case "eternalRival": return (await import("../chat.mjs")).eternalRival(actor);
    case "desperateRally": return (await import("../chat.mjs")).desperateRally(actor);
    case "bagOfTricks": return (await import("../chat.mjs")).bagOfTricks(actor);
    case "battleEdge": return (await import("../chat.mjs")).battleEdge(actor);
    case "undyingDetermination": return (await import("../chat.mjs")).undyingDetermination(actor);
    case "steadyAction": return (await import("../chat.mjs")).steadyAction(actor);
    case "weaponFixer": return (await import("../chat.mjs")).weaponFixer(actor);
    case "surgeOutOfSequence": return (await import("../chat.mjs")).surgeOutOfSequence(actor);
    case "swaggerChoose": return (await import("../chat.mjs")).swaggerChoose(actor);
    case "swaggerSpend": return (await import("../chat.mjs")).swaggerSpend(actor);
    case "sakeDrink": return (await import("../chat.mjs")).sakeDrink(actor);
    case "sakeBottle": return (await import("../chat.mjs")).sakeBottle(actor);
    case "variableFighter": return (await import("../chat.mjs")).variableFighter(actor, Boolean(context?.armed));
    case "undyingEnds": return (await import("../chat.mjs")).undyingEnds(actor);
    case "enhancedMark": return (await import("../chat.mjs")).enhancedMark(actor);
    case "yoinkGrenade": return (await import("../chat.mjs")).yoinkGrenade(actor, context);
    case "yoinkGuard": return (await import("../chat.mjs")).yoinkGuard(actor, context);
    case "silentFootsteps": return (await import("../chat.mjs")).silentFootsteps(actor);
    case "analyticFighter": return (await import("../chat.mjs")).analyticFighter(actor, args[0], context);
    case "explosivePerformance": return (await import("../chat.mjs")).explosivePerformance(actor);
    case "undyingFall": return (await import("../chat.mjs")).undyingFall(actor);
    case "rageStrike": return (await import("../chat.mjs")).rageStrike(actor);
    case "judoStrike": return (await import("../chat.mjs")).judoStrike(actor);
    case "speedblitz": return (await import("../chat.mjs")).speedblitz(actor);
    case "multiTypeStart": return (await import("../chat.mjs")).multiTypeStart(actor);
    case "personalEscape": return (await import("../use-maneuver.mjs")).escapeGrapple(actor, { free: true });
    case "surgingFocus": return (await import("../chat.mjs")).surgingFocus(actor);
    case "surgingSpare": return (await import("../chat.mjs")).surgingSpare(actor);
    case "goof": return (await import("../chat.mjs")).goof(actor);
    case "hocusPocus": return (await import("../chat.mjs")).hocusPocus(actor);
    case "gadaboutPower": return (await import("../chat.mjs")).gadaboutPower(actor);
    case "gadaboutTurn": return (await import("../chat.mjs")).gadaboutTurn(actor);

    case "dancerHype": {
      const { dancerHype } = await import("../chat.mjs");
      return dancerHype(actor);
    }

    case "rangerMove": {
      const { rangerMove } = await import("../chat.mjs");
      return rangerMove(actor);
    }

    case "whack": {
      const { whack } = await import("../chat.mjs");
      return whack(actor);
    }

    case "boom": {
      const { boom } = await import("../chat.mjs");
      return boom(actor);
    }

    case "shedCondition": {
      const besides = args.map(name => String(name).toLowerCase());
      const held = Object.entries(actor.system?.conditions ?? {}).filter(([key, stacks]) => ((Number(stacks) || 0) > 0)
        && !besides.includes(key) && (getTrait(key)?.kind === "conditions") && (getTrait(key)?.combatCondition !== false));
      if (!held.length) return UNSPENT;
      const { askPlayerChoice } = await import("../chat.mjs");
      const key = (held.length === 1) ? held[0][0] : await askPlayerChoice(actor, `${actor.name}: a stack off`,
        [...held.map(([each]) => ({ value: each, label: getTrait(each)?.name ?? each })), { value: "none", label: "None" }]);
      const stacks = held.find(([each]) => each === key)?.[1];
      if (stacks === undefined) return UNSPENT;
      const { setCondition } = await import("../conditions.mjs");
      return setCondition(actor, key, (Number(stacks) || 0) - 1);
    }

    case "integrateMajinDama": {
      const { integrateMajinDama } = await import("../majin-dama.mjs");
      return integrateMajinDama(actor);
    }
    case "expelMajinDama": {
      const { expelMajinDama } = await import("../majin-dama.mjs");
      return expelMajinDama(actor);
    }
    case "cutthroatShove": {
      const { cutthroatShove } = await import("../chat.mjs");
      return cutthroatShove(actor);
    }
    case "glassSoldiers": {
      const { glassSoldiers } = await import("../chat.mjs");
      return glassSoldiers(actor);
    }

    case "mutationRally": return (await import("../chat.mjs")).mutationRally(actor, args[0]);
    case "tuffleLegacy": return (await import("../chat.mjs")).tuffleLegacy(actor);
    case "wildChildAccess": return (await import("../chat.mjs")).wildChildAccess(actor);
    case "wildChildFeral": return (await import("../chat.mjs")).wildChildFeral(actor);
    case "neoTuffleFocus": return (await import("../chat.mjs")).neoTuffleFocus(actor);
    case "shadowRaisedSphere": return (await import("../chat.mjs")).demonRaisedSphere(actor, "shadow");
    case "shinjinRest": return (await import("../chat.mjs")).shinjinRest(actor);
    case "namekianFocus": return (await import("../chat.mjs")).namekianFocus(actor);
    case "angelRaisedStart": return (await import("../chat.mjs")).angelRaisedStart(actor);
    case "arcosianHit": return (await import("../chat.mjs")).arcosianHit(actor);
    case "demonRaisedSphere": return (await import("../chat.mjs")).demonRaisedSphere(actor);
    case "wereChoice": return (await import("../chat.mjs")).wereChoice(actor);
    case "terrifyingVisage": return (await import("../chat.mjs")).terrifyingVisage(actor);
    case "innateWeapon": return (await import("../chat.mjs")).innateWeapon(actor);
    case "lightConsume": return (await import("../chat.mjs")).lightConsume(actor, context?.targets?.[0] ?? null);
    case "lightDigest": return (await import("../chat.mjs")).lightDigest(actor);
    case "lightBurn": return (await import("../chat.mjs")).lightBurn(actor);
    case "shedPlates": return (await import("../chat.mjs")).shedPlates(actor);
    case "shedding": return (await import("../chat.mjs")).shedding(actor);
    case "spectralEnter": return (await import("../chat.mjs")).spectralEnter(actor);
    case "spectralExit": return (await import("../chat.mjs")).spectralExit(actor);
    case "bloodlustFeed": return (await import("../chat.mjs")).bloodlustFeed(actor, Number(args[0]) || 1);
    case "bloodlustStarve": return (await import("../chat.mjs")).bloodlustStarve(actor);
    case "broodMinion": return (await import("../chat.mjs")).broodMinion(actor);
    case "dissipate": return (await import("../chat.mjs")).dissipate(actor);
    case "quillBurst": return (await import("../chat.mjs")).quillBurst(actor);
    case "weatherSurge": return (await import("../chat.mjs")).weatherSurge(actor);
    case "grippyGrab": return (await import("../chat.mjs")).grippyGrab(actor);
    case "regenerateSurge": return (await import("../chat.mjs")).regenerateSurge(actor);
    case "alternateSight": return (await import("../chat.mjs")).alternateSight(actor, context?.targets?.[0] ?? null);
    case "arborealSurge": return (await import("../chat.mjs")).arborealSurge(actor);
    case "uproot": return (await import("../chat.mjs")).uproot(actor);
    case "bloodSteadfast": return (await import("../chat.mjs")).bloodSteadfast(actor, context?.knockedUuid);
    case "yakiSwarm": return (await import("../chat.mjs")).yakiSwarm(actor);
    case "kindheartedBoost": return (await import("../chat.mjs")).kindheartedBoost(actor, context?.targets?.[0] ?? null);
    case "battleBornMove": return (await import("../chat.mjs")).battleBornMove(actor);
    case "tuffleFusion": return (await import("../chat.mjs")).tuffleFusion(actor, context?.targets?.[0] ?? null);
    case "felineRallyKi": return (await import("../chat.mjs")).felineRallyKi(actor);
    case "catBurglarCopy": return (await import("../chat.mjs")).catBurglarCopy(actor, context?.opponentUuid ?? "");
    case "progenitor": return (await import("../chat.mjs")).progenitor(actor);
    case "miniMajin": return (await import("../chat.mjs")).miniMajin(actor, Number(args[0]) || 0);
    case "aiiieee": return (await import("../chat.mjs")).aiiieee(actor);
    case "glassKnights": return (await import("../chat.mjs")).glassKnights(actor);
    case "glassDecorations": return (await import("../chat.mjs")).glassDecorations(actor);
    case "glassSoldiersMove": {
      const { glassSoldiersMove } = await import("../chat.mjs");
      return glassSoldiersMove(actor);
    }

    case "glassification": {
      const { glassification } = await import("../chat.mjs");
      return glassification(actor, Number(context?.actionsSpent) || 1);
    }

    case "experiencedFighter": {
      const { experiencedFighter } = await import("../chat.mjs");
      return experiencedFighter(actor, context?.targets?.[0] ?? null);
    }

    case "clearConditions": {
      // Earthling Resolve (3): "remove all Combat Conditions afflicting you (except Suffocating)".
      const besides = args.map(name => String(name).toLowerCase());
      const { setCondition } = await import("../conditions.mjs");
      for (const [key, stacks] of Object.entries(actor.system?.conditions ?? {})) {
        if (!((Number(stacks) || 0) > 0) || besides.includes(key)) continue;
        const trait = getTrait(key);
        if ((trait?.kind !== "conditions") || (trait.combatCondition === false)) continue;
        await setCondition(actor, key, 0);
      }
      return;
    }

    case "rescueByPressure": {
      const { rescueByPressure } = await import("../chat.mjs");
      return rescueByPressure(actor);
    }

    case "pressureCheck": {
      const { pressureCheck } = await import("../chat.mjs");
      return pressureCheck(actor);
    }

    case "knockedProneClash": {
      const { knockedProneClash } = await import("../chat.mjs");
      return knockedProneClash(actor, context?.knockedUuid);
    }

    case "demonicImpediment": {
      const { demonicImpediment } = await import("../chat.mjs");
      return demonicImpediment(actor);
    }

    case "wrathSteadfast": {
      const { wrathSteadfast } = await import("../chat.mjs");
      return wrathSteadfast(actor, context?.knockedUuid);
    }
    case "impairFailed": {
      const { impairKnocked } = await import("../chat.mjs");
      return impairKnocked(actor, context?.failedUuid, "Wrath of the Dragon");
    }
    case "mastersPlace":
    case "mastersPlaceAny": {
      const { mastersPlace } = await import("../chat.mjs");
      return mastersPlace(actor, verb === "mastersPlaceAny");
    }
    case "freeFlowingStance": {
      const { freeFlowingStance } = await import("../chat.mjs");
      return freeFlowingStance(actor, Number(context?.actionsSpent) || 1);
    }
    case "failSteadfastKnocked": {
      const { steadfastFailedBy } = await import("../chat.mjs");
      return steadfastFailedBy(actor, context?.knockedUuid, context?.threshold);
    }
    case "buddySystem": {
      const { buddySystem } = await import("../chat.mjs");
      return buddySystem(actor);
    }
    case "pacifistMend": {
      const { pacifistMend } = await import("../chat.mjs");
      return pacifistMend(actor, context?.allyUuid, context?.gained);
    }
    case "pacifistEmpower": {
      const { pacifistEmpower } = await import("../chat.mjs");
      return pacifistEmpower(actor);
    }
    case "warriorEmpower": {
      const { warriorEmpower } = await import("../chat.mjs");
      return warriorEmpower(actor);
    }
    case "conduitPower": {
      const { conduitPower } = await import("../chat.mjs");
      return conduitPower(actor);
    }
    case "bondTo": {
      const { bondTo } = await import("../chat.mjs");
      return bondTo(actor, context?.allyUuid);
    }
    case "impairKnocked": {
      const { impairKnocked } = await import("../chat.mjs");
      return impairKnocked(actor, context?.knockedUuid);
    }
    case "markKnocked": {
      const { markKnocked } = await import("../chat.mjs");
      return markKnocked(actor, context?.knockedUuid, String(args[0] ?? ""), Number(args[1]) || 1);
    }

    case "followAlly": {
      const { followAlly } = await import("../chat.mjs");
      return followAlly(actor);
    }

    case "hazyDragon": {
      const { hazyDragon } = await import("../chat.mjs");
      return hazyDragon(actor);
    }
    case "nobleDragon": {
      const { nobleDragon } = await import("../chat.mjs");
      return nobleDragon(actor, context);
    }
    case "negativeEnergy": {
      const { negativeEnergy } = await import("../chat.mjs");
      return negativeEnergy(actor);
    }
    case "negativeClash": {
      const { negativeClash } = await import("../chat.mjs");
      return negativeClash(actor);
    }
    case "parasiteDrain": {
      const { parasiteDrain } = await import("../chat.mjs");
      return parasiteDrain(actor, context);
    }
    case "chooseInferior": {
      const { askInferior } = await import("../chat.mjs");
      return askInferior(actor);
    }
    case "chooseEnemy": {
      const { askEnemy } = await import("../chat.mjs");
      return askEnemy(actor);
    }

    case "lockOn": {
      const { askLockOn } = await import("../chat.mjs");
      return askLockOn(actor);
    }

    case "encounterTechnique": {
      const { tierTpCap } = await import("../technique.mjs");
      const cap = tierTpCap(actor.system.baseTierOfPower);
      const [item] = await actor.createEmbeddedDocuments("Item", [{
        name: "Inherited Creativity Technique", type: "maneuver", img: "icons/magic/lightning/bolt-strike-blue.webp",
        flags: { "dbu-ttrpg": { encounterTechnique: true } },
        system: { type: "standard", attacking: true, requiresTarget: true, tags: ["signature"], signature: { level: "super" } }
      }]);
      const { openForPlayer } = await import("../chat.mjs");
      return openForPlayer(actor, item,
        `Inherited Creativity: build its Signature Technique - up to ${cap} TP, no Disadvantages, no Technique Points spent.`);
    }

    case "steadfastPass":
      // Nothing of its own: what asked for it (chat.mjs rescueSteadfast) passes the Check once it has answered.
      return;

    case "trigger": {
      // What answers it and is left to the player (Triggered) is offered in a window on their client first.
      const moment = String(args[0] ?? "");
      const { offerTriggers } = await import("../chat.mjs");
      await offerTriggers(actor, moment);
      return fireMoment(actor, moment, context);
    }

    case "fillResource": {
      // To its most - Emperor (4)'s. None below it, nothing done and nothing spent.
      const { resourceCeiling, resourceDefinitions } = await import("./traits.mjs");
      const definitions = resourceDefinitions();
      const held = { ...(actor.system.resources ?? {}) };
      const gained = [];
      for (const name of args.map(each => String(each).toLowerCase())) {
        const most = Number(resourceCeiling(definitions[name], actor)) || 0;
        if (!most || ((Number(held[name]?.stacks) || 0) >= most)) continue;
        gained.push(name);
        held[name] = { ...(held[name] ?? {}), stacks: most, max: Math.max(Number(held[name]?.max) || 0, most) };
      }
      if (!gained.length) return UNSPENT;
      const { replaceObject } = await import("../conditions.mjs");
      await actor.update({ "system.resources": replaceObject(held) });
      return stacksGained(actor, gained);
    }
    case "greedySleep": return (await import("../chat.mjs")).greedySleep(actor);
    case "threeEyesDrop": return (await import("../chat.mjs")).threeEyesDrop(actor);
    case "heroSwitch": return (await import("../chat.mjs")).heroSwitch(actor);
    case "tamagamiIntegrate": return (await import("../chat.mjs")).tamagamiIntegrate(actor);
    case "cyberCopy": return (await import("../chat.mjs")).cyberCopy(actor, context);
    case "mutantIntegrate": return (await import("../chat.mjs")).mutantIntegrate(actor);
    case "mutantConsume": return (await import("../chat.mjs")).mutantConsume(actor);
    case "trollPower": return (await import("../chat.mjs")).trollPower(actor);
    case "bioBerserk": return (await import("../chat.mjs")).bioBerserk(actor);
    case "undeadRise": return (await import("../chat.mjs")).undeadRise(actor);
    case "sadisticKi": return (await import("../chat.mjs")).sadisticKi(actor);
    case "demonicGod": return (await import("../chat.mjs")).demonicGod(actor);
    case "supercomputerPowerUp": return (await import("../chat.mjs")).supercomputerPowerUp(actor);
    case "nanomachineDefeat": return (await import("../chat.mjs")).nanomachineDefeat(actor);
    case "onboardFocus": return (await import("../chat.mjs")).onboardFocus(actor);
    case "lingeringPower": return (await import("../chat.mjs")).lingeringPower(actor);
    case "goldenFruitPower": return (await import("../chat.mjs")).goldenFruitPower(actor);
    case "raiseTo": {
      // To at least this many, past any ceiling, never lower - Born for Battle's 3.
      const floor = Math.max(0, Number(args[0]) || 0);
      const held = { ...(actor.system.resources ?? {}) };
      const gained = [];
      for (const name of args.slice(1).map(each => String(each).toLowerCase())) {
        if ((Number(held[name]?.stacks) || 0) < floor) gained.push(name);
        held[name] = { ...(held[name] ?? {}), stacks: Math.max(Number(held[name]?.stacks) || 0, floor),
          max: Math.max(Number(held[name]?.max) || 0, floor) };
      }
      const { replaceObject } = await import("../conditions.mjs");
      await actor.update({ "system.resources": replaceObject(held) });
      return stacksGained(actor, gained);
    }

    case "gainOneOf": {
      // "You must apply it to either Strike, Dodge, or Wound (you decide)" - asked of whoever plays the character.
      const { resourceCeiling, resourceDefinitions } = await import("./traits.mjs");
      const definitions = resourceDefinitions();
      const held = actor.system.resources ?? {};
      // Its ceiling as an effect leaves it - Legendary Saiyan's 4 on the Wound.
      const ceiling = name => resourceCeiling(definitions[name], actor) || Infinity;
      const open = args.map(name => String(name).toLowerCase())
        .filter(name => definitions[name] && ((Number(held[name]?.stacks) || 0) < ceiling(name)));
      if (!open.length) return;
      const { askPlayerChoice } = await import("../chat.mjs");
      const chosen = (open.length === 1) ? open[0] : await askPlayerChoice(actor,
        `${actor.name}: ${definitions[open[0]].source || "a stack"}`,
        open.map(name => ({ value: name, label: definitions[name].label })));
      if (!chosen) return;
      const next = { ...held, [chosen]: { stacks: (Number(held[chosen]?.stacks) || 0) + 1,
        max: Math.max(Number(held[chosen]?.max) || 0, resourceCeiling(definitions[chosen], actor)) } };
      const { replaceObject } = await import("../conditions.mjs");
      await actor.update({ "system.resources": replaceObject(next) });
      return stacksGained(actor, [chosen]);
    }

    case "surge": {
      // The kind is forced when the effect names one: "use a Ki Surge" is not an offer
      // of either Surge.
      const { takeSurge } = await import("../chat.mjs");
      return takeSurge(actor, { source: "an effect", kind: args[0] ?? null, lifeMultiplier: Number(args[1]) || 1,
        extraDie: Number(args[2]) || 0, lifePerThresholdBT: Number(args[3]) || 0 });
    }

    case "gainGear": {
      const { getTrait } = await import("./traits.mjs");
      const definition = getTrait(String(args[0] ?? ""));
      if (!definition) return;
      const { gearItemFrom } = await import("../gear.mjs");
      return actor.createEmbeddedDocuments("Item", [gearItemFrom(definition, actor)]);
    }

    case "steamCloud": {
      const { steamCloud } = await import("../chat.mjs");
      return steamCloud(actor);
    }

    case "leaveState":
      return leaveState(actor, args[0] ?? context.state);

    case "expires":
      return expiresAt(actor, args[0], args[1], args[2] ?? 1);

    case "enterState":
      // No source name to hand it: a verb is run from a queue and the entry that queued
      // it is not carried here. The State's own name is what the card will say ran out,
      // which is the thing a reader wants anyway.
      return enterState(actor, args[0], args[1], args[2]);

    case "mightClash": {
      // Opened for real now that the system has Might Clashes. It used to print a line
      // saying one could be made and do nothing, so Pinned spent an Action on a
      // notification - the verb was declared, called, and had no clash behind it.
      //
      // Who it is against: whoever the effect names, and otherwise whoever the player
      // has targeted. Who pinned you is not recorded - a Combat Condition is a name and
      // a number of stacks and nothing else - and it is a thing the table knows, so it
      // is asked for by targeting rather than tracked.
      const against = named(args[0]) ?? game.user?.targets?.first()?.actor ?? null;
      if (!against) {
        ui.notifications?.warn(
          `${actor.name} needs an opponent for the Might Clash. Target a token first.`
        );
        return;
      }

      // Caught in a Net by the one they are Clashing with: "substitute your Might with this
      // recorded Scholarship Modifier for any Might Clashes made through ... the Pinned
      // Combat Condition inflicted through it." The note is on them while it lasts.
      const snared = actor.getFlag?.("dbu-ttrpg", "snaredBy");
      const netted = snared && (snared.by === against.uuid)
        && ((Number(actor.system?.conditions?.[snared.condition]) || 0) > 0);

      // Held by their Binding: "For every Turn that an Opponent ends with the Pinned Combat Condition through the
      // effects of your Binding, increase the Dice Score of their Might Clash through the effects of the Pinned
      // Combat Condition by 1(T) - using their Tier of Power" - and winning frees them.
      const bound = actor.getFlag?.("dbu-ttrpg", "boundBy");
      const binding = bound && (bound.by === against.uuid) && (bound.condition === "pinned")
        && ((Number(actor.system?.conditions?.pinned) || 0) > 0);
      const turns = binding ? (Number(bound.turns) || 0) : 0;
      // Held by their God Bind: won, freed.
      const godBound = actor.getFlag?.("dbu-ttrpg", "godBoundBy");
      const godBinding = godBound && (godBound.by === against.uuid) && ((Number(actor.system?.conditions?.pinned) || 0) > 0);

      const { postMightClash } = await import("../chat.mjs");
      return postMightClash(actor, against, {
        maneuverName: "Might Clash",
        reason: `${actor.name} against ${against.name}`,
        ...(binding ? { bindEscape: { applied: false, itemId: bound.itemId } } : {}),
        ...(godBinding ? { godBindEscape: { applied: false } } : {}),
        ...(turns ? { rowsFor: { [actor.uuid]: [{ label: `${bound.itemName}, ${turns} turn${(turns === 1) ? "" : "s"} held`,
          value: turns * Math.max(1, actor.system.tierOfPower ?? 1) }] } } : {}),
        ...(netted
          ? { mightFor: { [against.uuid]: snared.might },
              mightLabel: `${snared.itemName} (Scholarship)` }
          : {})
      });
    }

    case "grantOutOfSequence":
      // Offered rather than taken: an Out-of-Sequence Maneuver is still the player's to
      // play, and there is no dialog here to make them play it.
      ui.notifications?.info(`${actor.name} may act out of sequence.`);
      return;

    default:
      console.warn(`DBU TTRPG | Nothing in this system knows the verb "${verb}".`);
  }
}

/**
 * Take a Combat Condition off a character.
 *
 * Imported late rather than at the top, because conditions.mjs imports this module for
 * fireMoment - and a verb runs long after both are loaded, so there is nothing to gain
 * by tying the two together at parse time.
 */
export async function removeCondition(actor, name) {
  if (!name) return;
  const { setCondition } = await import("../conditions.mjs");
  return setCondition(actor, String(name).toLowerCase(), 0);
}

/** Put one on, at a number of stacks. */
export async function gainCondition(actor, name, stacks = 1) {
  if (!name) return;
  const { setCondition } = await import("../conditions.mjs");

  // Gained, so on top of what they already have. `setCondition` takes an absolute number,
  // and this handed it the amount gained - so "gain a stack of the Broken Combat
  // Condition" set a character already Broken twice back down to once.
  //
  // It never showed, because every Condition anything gained until now caps at one stack:
  // Braced and Hyped are marks, and setting a mark to one and adding one to it are the
  // same thing. The Lava Environment is the first to hand out a stack of something that
  // stacks, and Fatigued - which caps at two - has been quietly refusing its second since
  // Surging was written.
  const key = String(name).toLowerCase();
  const held = Number(actor.system?.conditions?.[key]) || 0;
  return setCondition(actor, key, held + stacks);
}

/** The wordings a duration can be written in, and the edges they come to. */
async function clockFor(duration) {
  const { EDGES } = await import("../durations.mjs");
  return {
    "turn": { edge: EDGES.END, next: false },
    "next-turn": { edge: EDGES.END, next: true },
    "start-of-turn": { edge: EDGES.START, next: false },
    "start-of-next-turn": { edge: EDGES.START, next: true },
    // "Until the end of this Combat Round" - High Speed Ace's.
    "round": { edge: EDGES.ROUND, next: false },
    "encounter": { edge: EDGES.ENCOUNTER, next: false }
  }[String(duration).toLowerCase()] ?? null;
}

/**
 * Put something the character already holds on a clock.
 *
 * The kind is worked out from what they are holding rather than named, because an effect
 * saying "this lasts until the start of your next turn" is not also saying what sort of
 * thing it is - the file already said that when it granted it.
 */
export async function expiresAt(actor, name, duration, stacks = 1) {
  if (!actor || !name) return false;

  const clock = await clockFor(duration);
  if (!clock) {
    console.warn(`DBU TTRPG | "${duration}" is not a duration this system knows.`);
    return false;
  }

  const key = String(name).toLowerCase();
  const { KINDS, lasting } = await import("../durations.mjs");

  // States first, then Conditions, then Resources - the order they are checked in makes
  // no practical difference, since a name is one of the three and not two of them.
  const kind = actor.system.states?.[key] ? KINDS.STATE
    : actor.system.conditions?.[key] ? KINDS.CONDITION
    : actor.system.resources?.[name] ? KINDS.RESOURCE
    : null;

  if (!kind) {
    console.warn(`DBU TTRPG | ${actor.name} is not holding "${name}", so nothing was put on a clock.`);
    return false;
  }

  // One clock per stack. A Condition's or a Resource's clock takes one stack off, so two
  // stacks gained together need two - and a single clock would leave the second one on
  // for ever.
  const each = { kind, key: (kind === KINDS.RESOURCE) ? name : key, ...clock, source: name };
  const many = Math.max(1, Math.round(Number(stacks) || 1));

  let set = false;
  for (let n = 0; n < many; n += 1) set = await lasting(actor, each) || set;
  return set;
}

/**
 * Enter a State, optionally on a clock.
 *
 * The counterpart of leaveState, which had no counterpart: nothing could put a State on
 * a character, so every State in the system arrived by somebody ticking a box. The
 * duration is named in the rulebook's own words and turned into edges where that rule
 * lives, rather than being counted here.
 */
export async function enterState(actor, name, level, duration, source = "") {
  if (!name) return false;

  const { raiseState } = await import("../conditions.mjs");
  const key = String(name).toLowerCase();

  // Out of it, its first level unless the effect says; in it already, a level higher for as long as this would have entered you
  // - and down again as that ends (the user's ruling; conditions.mjs raiseState).
  const wanted = Number.isFinite(Number(level)) && (Number(level) > 0) ? Number(level) : 1;
  const added = await raiseState(actor, key, wanted);
  if (!added) return false;

  if (!duration) return true;

  const { lasting, EDGES, KINDS } = await import("../durations.mjs");
  const clocks = {
    "turn": { edge: EDGES.END, next: false },
    "next-turn": { edge: EDGES.END, next: true },
    "start-of-turn": { edge: EDGES.START, next: false },
    "start-of-next-turn": { edge: EDGES.START, next: true },
    // "Until the end of this Combat Round" - High Speed Ace's.
    "round": { edge: EDGES.ROUND, next: false },
    "encounter": { edge: EDGES.ENCOUNTER, next: false }
  };

  const clock = clocks[String(duration).toLowerCase()];
  if (!clock) {
    console.warn(`DBU TTRPG | "${duration}" is not a duration this system knows.`);
    return true;
  }

  return lasting(actor, { kind: KINDS.STATE, key, ...clock, levels: added, source: source || key });
}

/** Leave a State - named, or all of them, which is what Defeat does. */
export async function leaveState(actor, name) {
  const { clearStates, setState } = await import("../conditions.mjs");
  if (!name) return clearStates(actor);
  return setState(actor, String(name).toLowerCase(), 0);
}

/**
 * Record that these effects were used, and disarm them.
 *
 * The two lists have the lifetimes their names say: `round` is emptied when a Combat
 * Round turns over and `encounter` when one ends, so a limit needs nothing here beyond
 * writing the id into the right one.
 */
async function recordUses(actor, spent, definition, context, disarmed = spent) {
  const ids = spent.map(use => `${use.sourceId}#${use.block}`);
  // Everything that answered is disarmed, whether its use was counted or not.
  const off = disarmed.map(use => `${use.sourceId}#${use.block}`);
  const armed = (actor.system.armedTalents ?? []).filter(id => !off.includes(id));

  const round = [...(actor.system.talentUses?.round ?? []), ...ids];
  const encounter = [...(actor.system.talentUses?.encounter ?? []), ...ids];

  // A Moment with a limit of its own records that it fired, separately from the effects
  // that answered it.
  if (definition.limit) {
    const key = momentKey(definition, context);
    if (definition.limit.per === "round") round.push(key);
    else encounter.push(key);
  }

  return actor.update({
    "system.talentUses.round": round,
    "system.talentUses.encounter": encounter,
    "system.armedTalents": armed
  });
}

/** What a verb answers when the player chose nothing, so its use is not counted (runPass). */
export const UNSPENT = "unspent";

/** Whether the block that was used calls one of these verbs. */
function callsAny(entries, use, verbs) {
  const block = entries.find(entry => entry.sourceId === use.sourceId)?.program?.blocks
    ?.find(each => each.index === use.block);
  const said = JSON.stringify(block?.statements ?? []);
  return [...verbs].some(verb => said.includes(`"verb":"${verb}"`));
}

/** The id a Moment's own limit is counted under. */
function momentKey(definition, context) {
  const each = definition.limit.each ? `:${context[definition.limit.each] ?? ""}` : "";
  return `moment:${definition.key}${each}`;
}

function momentAvailable(actor, definition, context) {
  const list = (definition.limit.per === "round")
    ? actor.system.talentUses?.round : actor.system.talentUses?.encounter;
  const key = momentKey(definition, context);
  const used = (list ?? []).filter(entry => entry === key).length;
  return used < (definition.limit.amount ?? 1);
}

/**
 * Say that an Automatic effect fired.
 *
 * Nobody pressed anything, so without this the table sees a number change and has to
 * guess which Trait did it. Triggered effects are left out: the player armed those, and
 * the roll they belong to already names them in its breakdown.
 */
async function announce(actor, entries, spent, moment) {
  const byId = new Map(entries.map(entry => [entry.blockId, entry]));

  const fired = spent
    .map(use => byId.get(`${use.sourceId}#${use.block}`))
    .filter(entry => entry?.program?.blocks?.[0]?.mode === "automatic");
  if (!fired.length) return;

  const lines = fired
    .map(entry => `<li>${Handlebars.escapeExpression(entry.sourceName)}</li>`)
    .join("");
  const label = getMoment(moment)?.label ?? moment;

  return ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="dbu-check">`
      + `<div class="dbu-check-parts">Automatic &middot; ${Handlebars.escapeExpression(label)}</div>`
      + `<ul class="dbu-auto-list">${lines}</ul></div>`
  });
}
