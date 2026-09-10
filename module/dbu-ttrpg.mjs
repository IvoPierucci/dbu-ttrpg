import DBUCharacterData from "./data/actor-character.mjs";
import DBUCharacterSheet from "./sheets/actor-character-sheet.mjs";
import DBUTalentData from "./data/item-talent.mjs";
import DBUTalentSheet from "./sheets/item-talent-sheet.mjs";
import DBUManeuverData from "./data/item-maneuver.mjs";
import DBUManeuverSheet from "./sheets/item-maneuver-sheet.mjs";
import { registerChatHooks, registerManeuverSocket } from "./chat.mjs";
import { registerDebugTools } from "./effects/debug.mjs";
import { forget, forgetAll } from "./effects/registry.mjs";
import { coreManeuverItems, registerHotbarDrop, registerMacroApi } from "./use-maneuver.mjs";
import { loadRaces, racialAttributeIncrease, racialLifeModifier } from "./races.mjs";
import { loadManeuvers } from "./maneuvers.mjs";
import { loadTraits } from "./effects/traits.mjs";
import { registerCombatHooks, registerDefeatHooks } from "./combat.mjs";
import { registerConditionHooks } from "./conditions.mjs";

Hooks.once("init", () => {
  console.log("DBU TTRPG | Initializing system");

  // Register the character data model for the "character" Actor type
  CONFIG.Actor.dataModels.character = DBUCharacterData;
  CONFIG.Item.dataModels.talent = DBUTalentData;
  CONFIG.Item.dataModels.maneuver = DBUManeuverData;

  // Initiative. Without this, Foundry has no formula to roll at all, and the button in
  // the Combat Tracker does nothing - which is exactly how it behaved.
  //
  // `@initiativeBonus` reads off the prepared character: Actor#getRollData returns
  // `system`, so the derived value is what the formula sees, effects included.
  //
  // Initiative Advantage is deliberately not in here. There is a Slot for it and a rule
  // behind it, but not one written down in this system yet, and guessing at how it
  // breaks a tie would put a rule in the game that is not in the book.
  CONFIG.Combat.initiative = {
    formula: `${DBUCharacterData.BASE_DIE} + @initiativeBonus`,
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
    types: ["talent"],
    makeDefault: true,
    label: "DBU Talent Sheet"
  });

  DocumentSheetConfig.registerSheet(foundry.documents.Item, "dbu-ttrpg", DBUManeuverSheet, {
    types: ["maneuver"],
    makeDefault: true,
    label: "DBU Maneuver Sheet"
  });

  registerChatHooks();
  registerHotbarDrop();
  registerCombatHooks();
  registerDefeatHooks();
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
Hooks.on("deleteItem", item => forget(item.uuid));

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
