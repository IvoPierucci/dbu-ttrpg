import DBUCharacterData from "./data/actor-character.mjs";
import DBUCharacterSheet from "./sheets/actor-character-sheet.mjs";
import { registerChatHooks, registerManeuverSocket } from "./chat.mjs";
import { loadRaces, racialAttributeIncrease, racialLifeModifier } from "./races.mjs";
import { loadManeuvers } from "./maneuvers.mjs";

Hooks.once("init", () => {
  console.log("DBU TTRPG | Initializing system");

  // Register the character data model for the "character" Actor type
  CONFIG.Actor.dataModels.character = DBUCharacterData;

  // Register the character sheet using the v13+/v14 ApplicationV2 sheet registration API
  const DocumentSheetConfig = foundry.applications.apps.DocumentSheetConfig;
  DocumentSheetConfig.unregisterSheet(foundry.documents.Actor, "core", foundry.appv1.sheets.ActorSheet);
  DocumentSheetConfig.registerSheet(foundry.documents.Actor, "dbu-ttrpg", DBUCharacterSheet, {
    types: ["character"],
    makeDefault: true,
    label: "DBU Character Sheet"
  });

  registerChatHooks();
});

// Races are files under races/, so loading them is asynchronous. Hooks are not
// awaited, so an Actor may already have been prepared against an empty registry by
// the time the files arrive; re-preparing afterwards settles any Life totals that
// were computed with no Racial Life Modifier.
Hooks.once("setup", async () => {
  // game.socket is not available during init, so the listener is registered here.
  registerManeuverSocket();
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
});
