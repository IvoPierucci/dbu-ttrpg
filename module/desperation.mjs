/**
 * Desperation Effects (Damage & Recovery): "a unique form of Karmic Effect ... that you can only use while your Character is
 * Defeated. You can use these even when your Character is dead, as long as you have the Karma Points."
 *
 * Each is asked of whoever plays the Defeated Ally holding the Karma for it, at the moment it answers - none needs a card of its
 * own: "You Can't Die...!" as an Ally would be Defeated by an Attacking Maneuver (combat.mjs beginDefeat); "You Can't Lose...!"
 * beside the Karmic Effects of a Clash an Ally lost (chat.mjs offerableTo); "Bring Out Your Power!" as an Ally's Power Up is
 * used; "Now's Your Chance!" as an Ally declares an Attacking Maneuver; "It's Up to You, Now." as an Ally's turn begins; and
 * "Just Take It, But Finish Them Now!" from the Defeated character's own sheet, which has no moment of its own.
 *
 * Honorbound (2): "While Defeated, the first Desperate Effect you use has its Karma Point Cost reduced by 1 (this can reduce it
 * to 0)" - the first of each Defeat.
 */

const SCOPE = "dbu-ttrpg";

/** The six, as the page lists them. */
export const DESPERATION_EFFECTS = Object.freeze([
  { key: "cant-die", name: "“You Can’t Die…!”", cost: 1, per: "encounter",
    text: "If one of your Allies would be Defeated by an Attacking Maneuver, you may set their Life Points to 1 instead." },
  { key: "cant-lose", name: "“You Can’t Lose…!”", cost: 1, per: "round",
    text: "If an Ally loses a Clash against an Opponent, they can reroll that Clash. If the Clash used Skills, increase their Dice "
      + "Score by 1d4. If the Clash used Attribute Modifiers, Combat Rolls, Saving Throws, or Might, increase their Dice Score by 2(T)." },
  { key: "bring-power", name: "“Bring Out Your Power!”", cost: 1, per: "round",
    text: "If an Ally uses the Power Up Maneuver, they gain an additional stack of Power from that use of the Maneuver." },
  { key: "your-chance", name: "“Now’s Your Chance!”", cost: 1, per: "round",
    text: "When an Ally makes an Attacking Maneuver, you may spend Ki Points up to 1/2 of your Max Capacity to increase the Wound "
      + "Roll of that Attacking Maneuver by an equal amount." },
  { key: "take-it", name: "“Just Take It, But Finish Them Now!”", cost: 1, per: "encounter",
    text: "You may transfer any amount of your Ki Points to an Ally of your choice." },
  { key: "up-to-you", name: "“It’s Up to You, Now.”", cost: 2, per: "encounter",
    text: "Target an Ally at the start of their turn. They enter the Entrusted State until the start of their next turn." }
]);

export function desperationEffect(key) {
  return DESPERATION_EFFECTS.find(effect => effect.key === key) ?? null;
}

function roundKey() {
  return `${game.combat?.id ?? "none"}:${game.combat?.round ?? 0}`;
}

function encounterKey() {
  return game.combat?.id ?? "none";
}

/** This Defeat, for Honorbound (2)'s first: the Encounter and how many Defeats were got out of in it. */
function defeatKey(actor) {
  return `${encounterKey()}:${Number(actor.system?.defeatsEscaped) || 0}`;
}

/** Whether it may still be used - Defeated, its 1/Round or 1/Encounter not spent. */
function open(holder, effect) {
  if (!holder?.system?.defeated) return false;
  const used = holder.getFlag?.(SCOPE, "desperation")?.[effect.key];
  return used !== ((effect.per === "round") ? roundKey() : encounterKey());
}

/** What it costs them now: Honorbound (2)'s 1 off the first of this Defeat. */
export function desperationCost(holder, effect) {
  const first = (holder?.system?.effects?.slots?.["honorbound.desperation"] === true)
    && (holder.getFlag?.(SCOPE, "honorboundDefeat") !== defeatKey(holder));
  return Math.max(0, effect.cost - (first ? 1 : 0));
}

/** The Defeated Allies of `ally` on the scene who could use it now. */
export function desperationHolders(ally, key, alliesOnScene) {
  const effect = desperationEffect(key);
  if (!effect || !ally) return [];
  return alliesOnScene(ally).filter(holder => (holder.uuid !== ally.uuid) && open(holder, effect)
    && ((Number(holder.system?.karma) || 0) >= desperationCost(holder, effect)));
}

/** Paid: the Karma, its limit, and Honorbound (2)'s first. */
export async function payDesperation(holder, key) {
  const effect = desperationEffect(key);
  const cost = desperationCost(holder, effect);
  const karma = Number(holder.system?.karma) || 0;
  if (karma < cost) return false;
  const { requestActorUpdate } = await import("./chat.mjs");
  const first = (holder.system?.effects?.slots?.["honorbound.desperation"] === true)
    && (holder.getFlag?.(SCOPE, "honorboundDefeat") !== defeatKey(holder));
  await requestActorUpdate(holder, { "system.karma": karma - cost,
    [`flags.${SCOPE}.desperation.${key}`]: (effect.per === "round") ? roundKey() : encounterKey(),
    ...(first ? { [`flags.${SCOPE}.honorboundDefeat`]: defeatKey(holder) } : {}) });
  return true;
}

/** Asked of whoever plays the holder: used, or not. */
async function asked(holder, key, label) {
  const effect = desperationEffect(key);
  const { askPlayerChoice } = await import("./chat.mjs");
  const cost = desperationCost(holder, effect);
  return (await askPlayerChoice(holder, `${holder.name}: ${effect.name} (${cost} Karma)`,
    [{ value: "yes", label }, { value: "no", label: "No" }])) === "yes";
}

/** "You Can't Die...!": an Ally would be Defeated by an Attacking Maneuver - their Life Points 1 instead. Whether it was used. */
export async function youCantDie(target) {
  const { alliesOnScene } = await import("./chat.mjs");
  for (const holder of desperationHolders(target, "cant-die", alliesOnScene)) {
    if (!await asked(holder, "cant-die", `${target.name}'s Life Points 1 instead`)) continue;
    if (!await payDesperation(holder, "cant-die")) continue;
    const { requestActorUpdate } = await import("./chat.mjs");
    await requestActorUpdate(target, { "system.life.value": 1 });
    return holder;
  }
  return null;
}

/** "Bring Out Your Power!": an Ally's Power Up - a stack of Power more. */
export async function bringOutYourPower(ally) {
  const { alliesOnScene } = await import("./chat.mjs");
  for (const holder of desperationHolders(ally, "bring-power", alliesOnScene)) {
    if (!await asked(holder, "bring-power", `${ally.name}: a stack of Power more`)) continue;
    if (!await payDesperation(holder, "bring-power")) continue;
    const { setResource } = await import("./chat.mjs");
    await setResource(ally, "power", (Number(ally.system.resources?.power?.stacks) || 0) + 1);
    ui.notifications.info(`${holder.name}: ${desperationEffect("bring-power").name} - ${ally.name} gains a stack of Power.`);
    return;
  }
}

/** "Now's Your Chance!": an Ally's Attacking Maneuver declared - Ki up to half their Max Capacity, as much on its Wound Roll. */
export async function nowsYourChance(ally, declared) {
  if (!declared) return declared;
  const { alliesOnScene } = await import("./chat.mjs");
  for (const holder of desperationHolders(ally, "your-chance", alliesOnScene)) {
    const most = Math.min(Number(holder.system?.ki?.value) || 0, Math.floor((Number(holder.system?.capacity?.max) || 0) / 2));
    if (most <= 0) continue;
    const { askPlayerAmount, requestActorUpdate } = await import("./chat.mjs");
    const effect = desperationEffect("your-chance");
    const ki = Math.min(most, await askPlayerAmount(holder,
      `${holder.name}: ${effect.name} (${desperationCost(holder, effect)} Karma) - ${ally.name}'s attack`, most,
      "Ki Points - as much on its Wound Roll (0: not used)"));
    if (!(ki > 0) || !await payDesperation(holder, "your-chance")) continue;
    await requestActorUpdate(holder, { "system.ki.value": (Number(holder.system.ki?.value) || 0) - ki,
      "system.capacity.spent": (Number(holder.system.capacity?.spent) || 0) + ki });
    return { ...declared, woundExtra: [...(declared.woundExtra ?? []), { label: `Now's Your Chance! (${holder.name})`, value: ki }] };
  }
  return declared;
}

/** "It's Up to You, Now.": an Ally's turn begins - Entrusted till the start of their next. */
export async function itsUpToYou(ally) {
  const { alliesOnScene } = await import("./chat.mjs");
  for (const holder of desperationHolders(ally, "up-to-you", alliesOnScene)) {
    if (!await asked(holder, "up-to-you", `${ally.name}: Entrusted till the start of their next turn`)) continue;
    if (!await payDesperation(holder, "up-to-you")) continue;
    const { enterState } = await import("./effects/moments-runtime.mjs");
    await enterState(ally, "entrusted", 1, "start-of-next-turn", desperationEffect("up-to-you").name);
    return;
  }
}

/** "Just Take It, But Finish Them Now!": from the Defeated character's own sheet - which Ally, how much of their Ki. */
export async function justTakeIt(holder) {
  const { alliesOnScene } = await import("./chat.mjs");
  const effect = desperationEffect("take-it");
  if (!holder?.system?.defeated) return ui.notifications.warn(`${holder?.name ?? "They"} must be Defeated.`);
  if (!open(holder, effect)) return ui.notifications.warn(`${effect.name}: already used this Combat Encounter.`);
  if ((Number(holder.system.karma) || 0) < desperationCost(holder, effect)) {
    return ui.notifications.warn(`${effect.name} needs ${desperationCost(holder, effect)} Karma.`);
  }
  const allies = alliesOnScene(holder).filter(ally => ally.uuid !== holder.uuid);
  if (!allies.length) return ui.notifications.warn(`${holder.name} has no Ally on the scene.`);
  const { askPlayerChoice, askPlayerAmount, requestActorUpdate } = await import("./chat.mjs");
  const id = (allies.length === 1) ? allies[0].uuid : await askPlayerChoice(holder, `${holder.name}: ${effect.name} - to whom`,
    allies.map(ally => ({ value: ally.uuid, label: ally.name })));
  const ally = allies.find(each => each.uuid === id);
  const most = Number(holder.system.ki?.value) || 0;
  if (!ally || (most <= 0)) return;
  const ki = Math.min(most, await askPlayerAmount(holder, `${holder.name}: ${effect.name} - to ${ally.name}`, most, "Ki Points"));
  if (!(ki > 0) || !await payDesperation(holder, "take-it")) return;
  await requestActorUpdate(holder, { "system.ki.value": most - ki });
  await requestActorUpdate(ally, { "system.ki.value": (Number(ally.system.ki?.value) || 0) + ki });
  return ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: holder }),
    content: `<div class="dbu-settled-note">${Handlebars.escapeExpression(`${effect.name}: ${holder.name} gives ${ally.name} ${ki} Ki Points.`)}</div>` });
}
