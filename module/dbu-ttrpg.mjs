import DBUCharacterData from "./data/actor-character.mjs";
import DBUCharacterSheet from "./sheets/actor-character-sheet.mjs";
import DBUTalentData from "./data/item-talent.mjs";
import DBURacialData from "./data/item-racial.mjs";
import { registerRacialHooks } from "./racial.mjs";
import { registerIntegratedHooks } from "./integrated.mjs";
import { registerNaturalArmorHooks } from "./natural-armor.mjs";
import DBUTalentSheet from "./sheets/item-talent-sheet.mjs";
import DBUManeuverData from "./data/item-maneuver.mjs";
import DBUManeuverSheet from "./sheets/item-maneuver-sheet.mjs";
import DBUGearData from "./data/item-gear.mjs";
import DBUGearSheet from "./sheets/item-gear-sheet.mjs";
import { registerChatHooks, registerManeuverSocket } from "./chat.mjs";
import { registerDebugTools } from "./effects/debug.mjs";
import { forget, forgetAll } from "./effects/registry.mjs";
import { coreManeuverItems, registerHotbarDrop, registerMacroApi } from "./use-maneuver.mjs";
import { loadRaces, racialAttributeIncrease, racialLifeModifier } from "./races.mjs";
import { loadManeuvers } from "./maneuvers.mjs";
import { getTrait, loadTraits } from "./effects/traits.mjs";
import { registerCombatHooks, registerBreathHooks, registerDefeatHooks, registerWornBreathHooks, registerRacialLifeHooks }
  from "./combat.mjs";
import { registerConditionHooks } from "./conditions.mjs";

Hooks.once("init", () => {
  console.log("DBU TTRPG | Initializing system");

  // Register the character data model for the "character" Actor type
  CONFIG.Actor.dataModels.character = DBUCharacterData;
  CONFIG.Item.dataModels.talent = DBUTalentData;
  CONFIG.Item.dataModels.racial = DBURacialData;
  CONFIG.Item.dataModels.maneuver = DBUManeuverData;
  CONFIG.Item.dataModels.gear = DBUGearData;

  // Initiative. Without this, Foundry has no formula to roll at all, and the button in
  // the Combat Tracker does nothing - which is exactly how it behaved.
  //
  // `@initiativeBonus` reads off the prepared character: Actor#getRollData returns
  // `system`, so the derived value is what the formula sees, effects included.
  //
  // Initiative Advantage is deliberately not in here. There is a Slot for it and a rule
  // behind it, but not one written down in this system yet, and guessing at how it
  // breaks a tie would put a rule in the game that is not in the book.
  // A Botch's or a Critical's window, asked of the player whose character it is, wherever the roll is made.
  CONFIG.queries["dbu-ttrpg.outcomeTriggers"] = async ({ actorUuid, kind, context }) => {
    const { showOutcomeWindow } = await import("./chat.mjs");
    return showOutcomeWindow(fromUuidSync(actorUuid), kind, context ?? {});
  };

  // A sheet opened for the player whose character it is - Inherited Creativity's Technique, made on the GM's client.
  CONFIG.queries["dbu-ttrpg.openSheet"] = async ({ uuid, note }) => {
    if (note) ui.notifications.info(note);
    return fromUuidSync(uuid)?.sheet?.render(true);
  };

  // A choice an effect asks for, of the player whose character it is - Born for Battle's Strike, Dodge or Wound.
  CONFIG.queries["dbu-ttrpg.choose"] = async (data) => {
    const { showChoice } = await import("./chat.mjs");
    return showChoice(data);
  };

  // An amount an effect asks for, of the player whose character it is - Discarded Divinity's Ki for Life Points.
  CONFIG.queries["dbu-ttrpg.amount"] = async (data) => {
    const { showAmount } = await import("./chat.mjs");
    return showAmount(data);
  };

  CONFIG.Combat.initiative = {
    // `@initiativeDie`: the Base Die, or Improved Initiative's twice.
    formula: "@initiativeDie + @initiativeBonus",
    decimals: 0
  };

  // Register the character sheet using the v13+/v14 ApplicationV2 sheet registration API
  const DocumentSheetConfig = foundry.applications.apps.DocumentSheetConfig;
  DocumentSheetConfig.unregisterSheet(foundry.documents.Actor, "core", foundry.appv1.sheets.ActorSheet);
  DocumentSheetConfig.registerSheet(foundry.documents.Actor, "dbu-ttrpg", DBUCharacterSheet, {
    types: ["character"],
    makeDefault: true,
    label: "DBU Character Sheet"
  });

  DocumentSheetConfig.unregisterSheet(foundry.documents.Item, "core", foundry.appv1.sheets.ItemSheet);
  DocumentSheetConfig.registerSheet(foundry.documents.Item, "dbu-ttrpg", DBUTalentSheet, {
    // A Racial Trait is written and edited as a Talent is: its Effect tab is the whole of what it does.
    types: ["talent", "racial"],
    makeDefault: true,
    label: "DBU Talent Sheet"
  });

  DocumentSheetConfig.registerSheet(foundry.documents.Item, "dbu-ttrpg", DBUManeuverSheet, {
    types: ["maneuver"],
    makeDefault: true,
    label: "DBU Maneuver Sheet"
  });

  DocumentSheetConfig.registerSheet(foundry.documents.Item, "dbu-ttrpg", DBUGearSheet, {
    types: ["gear"],
    makeDefault: true,
    label: "DBU Gear Sheet"
  });

  registerChatHooks();
  registerHotbarDrop();
  registerCombatHooks();
  registerDefeatHooks();
  registerRacialLifeHooks();
  registerRacialHooks();
  registerIntegratedHooks();
  registerNaturalArmorHooks();
  registerBreathHooks();
  registerWornBreathHooks();
  registerConditionHooks();
});

// Recovering above a Health Threshold clears the Steadfast Check recorded there, so
// that dropping back down calls for a fresh one rather than reusing the old result.
Hooks.on("preUpdateActor", (actor, changes) => {
  if (actor.type !== "character") return;

  const life = foundry.utils.getProperty(changes, "system.life.value");
  if (life === undefined) return;

  const threshold = DBUCharacterData.thresholdKey(life, actor.system.life.max);
  for (const key of DBUCharacterData.thresholdsAbove(threshold)) {
    if (actor.system.thresholdChecks[key]) {
      foundry.utils.setProperty(changes, `system.thresholdChecks.${key}`, "");
    }
  }
});

// Races are files under races/, so loading them is asynchronous. Hooks are not
// awaited, so an Actor may already have been prepared against an empty registry by
// the time the files arrive; re-preparing afterwards settles any Life totals that
// were computed with no Racial Life Modifier.
// Registered at both points, guarded against running twice: setup is where the socket
// is reliably available, and ready is the backstop for the case where it was not.
Hooks.once("ready", registerManeuverSocket);

// Compiled effects are cached by the content they came from, so a stale entry cannot
// happen - an edit produces a different key. These only bound how much is kept.
Hooks.on("updateItem", item => forget(item.uuid));

// Apparel grown out of: "If, while wearing a piece of Apparel, your Size Category would increase
// to be 2+ Size Categories larger than the Size Category for that piece of Apparel, that piece of
// Apparel is destroyed." A Size moves with the character and with what they carry - a State, a
// Micro Band - so asked after either changes, by the client that changed it, once.
{
  const outgrowing = async (actor, userId) => {
    if ((userId !== game.user.id) || (actor?.type !== "character")) return;
    const { destroyOutgrown } = await import("./gear.mjs");
    await destroyOutgrown(actor, Object.keys(DBUCharacterData.SIZES), getTrait);
  };
  Hooks.on("updateActor", (actor, changes, options, userId) => outgrowing(actor, userId));
  Hooks.on("updateItem", (item, changes, options, userId) => outgrowing(item.parent, userId));
  Hooks.on("createItem", (item, options, userId) => outgrowing(item.parent, userId));
  Hooks.on("deleteItem", (item, options, userId) => outgrowing(item.parent, userId));
}
Hooks.on("deleteItem", item => forget(item.uuid));

// Talents come from the Progression tab: the Talent Addition rows reached, or the Power Level moved - made to match, by
// whoever made the change.
Hooks.on("updateActor", async (actor, changes, options, userId) => {
  if ((userId !== game.user.id) || !changes.system || !(("progression" in changes.system) || ("powerLevel" in changes.system))) return;
  const { syncProgressionTalents } = await import("./talents.mjs");
  await syncProgressionTalents(actor);
});

// Conduit of Spirit (1): "while you have at least 1 Ally and none of your Allies are Defeated" - read off the others, so read
// again as one of them is hurt or healed, or a token comes, goes or changes side.
// Synchronized Combatants (2): beside your Partner - read again as a token moves, too, or a choice of it changes.
const READ_OFF_OTHERS = new Set(["conduit-of-spirit", "synchronized-combatants", "chosen-rival"]);
function conduitRefresh() {
  for (const actor of new Set((canvas?.tokens?.placeables ?? []).map(token => token.actor))) {
    if (!actor || !Array.from(actor.items ?? []).some(item => READ_OFF_OTHERS.has(item.flags?.["dbu-ttrpg"]?.sourceId))) continue;
    actor.reset();
    if (actor.sheet?.rendered) actor.sheet.render();
  }
}
Hooks.on("updateActor", (actor, changes) => { if (changes.system?.life) conduitRefresh(); });

// All Sizes Fit Me (2): a Size Category changed - by whatever changed it, by whoever made the change.
async function sizeWatch(actor, userId) {
  if ((userId !== game.user.id) || (actor?.type !== "character")) return;
  const { sizeChangeCheck } = await import("./chat.mjs");
  await sizeChangeCheck(actor);
}
Hooks.on("updateActor", (actor, changes, options, userId) => sizeWatch(actor, userId));
Hooks.on("updateItem", (item, changes, options, userId) => sizeWatch(item.parent, userId));
Hooks.on("createItem", (item, options, userId) => sizeWatch(item.parent, userId));
Hooks.on("deleteItem", (item, options, userId) => sizeWatch(item.parent, userId));

// Frequent Flyer (4): a Character entering a High Environment - its height before the change, kept for after it. Slow
// Starter (4): the stacks of Holding Back before, the same way.
Hooks.on("preUpdateActor", (actor, changes, options) => {
  if (foundry.utils.hasProperty(changes, "system.battlefield.highEnvironment")) {
    options.dbuHighBefore = Number(actor.system?.battlefield?.highEnvironment) || 0;
  }
  if (foundry.utils.hasProperty(changes, "system.resources") && !options.dbuEncounterStart) {
    options.dbuHoldingBefore = Number(actor.system?.resources?.holdingback?.stacks) || 0;
  }
  // Undying Determination (2): "your Life Points cannot be reduced below that value" - held there while its mark lasts.
  const floor = Number(actor.getFlag?.("dbu-ttrpg", "undyingFloor"));
  if (Number.isFinite(floor) && foundry.utils.hasProperty(changes, "system.life.value")
    && (Number(foundry.utils.getProperty(changes, "system.life.value")) < floor)) {
    foundry.utils.setProperty(changes, "system.life.value", floor);
  }
  // High Risk Battler (2): the Life Points before they are regained.
  if (foundry.utils.hasProperty(changes, "system.life.value") && !options.dbuHighRisk
    && (actor.system?.effects?.slots?.["highRisk.forgo"] === true)) {
    options.dbuLifeBefore = Number(actor.system?.life?.value) || 0;
  }
});
Hooks.on("updateActor", async (actor, changes, options, userId) => {
  if ((userId !== game.user.id) || !("dbuLifeBefore" in options) || options.dbuEncounterStart) return;
  const { highRiskForgo } = await import("./chat.mjs");
  await highRiskForgo(actor, options.dbuLifeBefore);
});
Hooks.on("updateActor", async (actor, changes, options, userId) => {
  if ((userId !== game.user.id) || !(Number(options.dbuHoldingBefore) > 0) || !game.combat?.started) return;
  if ((Number(actor.system?.resources?.holdingback?.stacks) || 0) > 0) return;
  // Every stack of Holding Back gone: what answers losing them - Slow Starter's Legend Realized.
  const { answerFor } = await import("./chat.mjs");
  await answerFor(actor, "holding-back-lost");
});
Hooks.on("updateActor", async (actor, changes, options, userId) => {
  if ((userId !== game.user.id) || !("dbuHighBefore" in options) || (actor.type !== "character")) return;
  const { frequentFlyerCheck } = await import("./chat.mjs");
  await frequentFlyerCheck(actor, options.dbuHighBefore);
});

// Improved Initiative (2), Alert (3): Initiative Advantage read off the Combat's Initiative Values - read again as they change.
const ADVANTAGE_READERS = new Set(["improved-initiative", "alert", "attentive-warrior", "speedblitz", "lightning-initiative",
  "patient-fighter"]);
function initiativeRefresh(combat) {
  for (const actor of new Set(Array.from(combat?.combatants ?? []).map(entry => entry.actor))) {
    if (!actor || !Array.from(actor.items ?? []).some(item => ADVANTAGE_READERS.has(item.flags?.["dbu-ttrpg"]?.sourceId))) continue;
    actor.reset();
    if (actor.sheet?.rendered) actor.sheet.render();
  }
}
Hooks.on("updateCombatant", (combatant, changes) => { if ("initiative" in (changes ?? {})) initiativeRefresh(combatant.parent); });
// Patient Fighter (1): an Initiative rolled at the Encounter's start, by whoever rolled it - not one moved after (turnEvents off).
Hooks.on("updateCombatant", async (combatant, changes, options, userId) => {
  if ((userId !== game.user.id) || (options?.turnEvents === false) || !Number.isFinite(changes?.initiative)) return;
  const { patientFighterShare } = await import("./chat.mjs");
  await patientFighterShare(combatant);
});
Hooks.on("createCombatant", combatant => initiativeRefresh(combatant.parent));
Hooks.on("deleteCombatant", combatant => initiativeRefresh(combatant.parent));
Hooks.on("deleteCombat", combat => initiativeRefresh(combat));
Hooks.on("createToken", () => conduitRefresh());
// Favored Technique (2): its Advantage read by the Technique itself - read again as the Talent comes, goes or is chosen anew.
for (const hook of ["createItem", "updateItem", "deleteItem"]) {
  Hooks.on(hook, item => {
    if (["favored-technique", "powerful-technique"].includes(item.flags?.["dbu-ttrpg"]?.sourceId)) item.parent?.reset?.();
  });
}
Hooks.on("deleteToken", () => conduitRefresh());
Hooks.on("updateToken", (token, changes) => {
  if (["disposition", "x", "y"].some(key => key in (changes ?? {}))) conduitRefresh();
});
Hooks.on("updateItem", item => { if (READ_OFF_OTHERS.has(item.flags?.["dbu-ttrpg"]?.sourceId)) conduitRefresh(); });

Hooks.once("setup", async () => {
  registerManeuverSocket();
  registerDebugTools();
  registerMacroApi();
  // Traits first: the Maneuvers are built from those files, so loading the two at the
  // same time would sometimes find nothing there.
  await loadTraits();
  await Promise.all([loadRaces(), loadManeuvers()]);
  for (const actor of game.actors ?? []) actor.prepareData();
});

// Seed a new character with its progression table and a full Life/Ki pool.
// This runs on the document source before creation, because both depend on data the
// ArrayField's own "initial" option cannot express, and because Life and Ki maximums
// are derived - there is no prepared data to read from yet at this point.
Hooks.on("preCreateActor", (actor, data, options, userId) => {
  if (actor.type !== "character") return;

  const updates = {};

  const submitted = data.system?.progression;
  const progression = (submitted?.length) ? submitted : DBUCharacterData.buildDefaultProgression();
  if (!submitted?.length) updates["system.progression"] = progression;

  const powerLevel = data.system?.powerLevel ?? 1;
  const race = data.system?.race;
  updates["system.life.value"] = DBUCharacterData.maxLife({
    powerLevel,
    tenacityScore: DBUCharacterData.attributeScore(
      progression, "tenacity", powerLevel, racialAttributeIncrease(race, "tenacity")
    ),
    racialLifeModifier: racialLifeModifier(race)
  });
  updates["system.ki.value"] = DBUCharacterData.maxKi({ powerLevel });

  actor.updateSource(updates);

  // Every character carries their own copies of the Core Maneuvers. That is what lets
  // one be dragged to the hotbar, and what makes room in the same list for the
  // Signature Techniques and Unique Abilities bought per character.
  if (!actor.items.size) {
    const starting = coreManeuverItems();
    if (starting.length) actor.updateSource({ items: starting });
  }
});
