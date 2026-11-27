/**
 * Zooners (a Minion Race): Reinforced Suit, Nice Shooting, Raised Gravity, Shooting Mindset.
 */

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const ROOT = process.argv[2];
const APP = (process.env.FOUNDRY_APP || String.raw`C:\Program Files\Foundry Virtual Tabletop\resources\app`);
const appUrl = p => pathToFileURL(path.join(APP, p)).href;
const modUrl = p => pathToFileURL(path.join(ROOT, "module", p)).href;

globalThis.CONST = {};
globalThis.foundry = {};
await import(appUrl("common/primitives/_module.mjs"));
globalThis.foundry.utils = { ...await import(appUrl("common/utils/_module.mjs")) };
globalThis.foundry.data = await import(appUrl("common/data/_module.mjs"));
const { default: DataModel } = await import(appUrl("common/abstract/data.mjs"));
globalThis.foundry.abstract = { DataModel, TypeDataModel: DataModel };
globalThis.ui = { notifications: { warn: () => {}, error: () => {}, info: () => {} } };

const TRAITS = path.join(ROOT, "traits");
globalThis.foundry.utils.fetchJsonWithTimeout = async () =>
  JSON.parse(fs.readFileSync(path.join(TRAITS, "index.json"), "utf8"));
globalThis.fetch = async url => {
  const file = path.join(TRAITS, String(url).replace("systems/dbu-ttrpg/traits/", ""));
  if (!fs.existsSync(file)) return { ok: false, status: 404, statusText: "missing" };
  return { ok: true, status: 200, text: async () => fs.readFileSync(file, "utf8") };
};

const { loadTraits } = await import(modUrl("effects/traits.mjs"));
const { default: DBUCharacterData } = await import(modUrl("data/actor-character.mjs"));
const ALLIES = await import(modUrl("allies.mjs"));
const TYPES = await import(modUrl("actor-types.mjs"));
await loadTraits();

let failed = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`);
};

const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), "utf8");

/** What a model's parent has to be: a DataModel - the Actor, with its type. */
class ActorStub extends DataModel {
  static defineSchema() { return {}; }
}

const { getTrait } = await import(modUrl("effects/traits.mjs"));
const { compile } = await import(modUrl("effects/parser.mjs"));
const M = await import(modUrl("maneuvers.mjs"));
const RACES = await import(modUrl("races.mjs"));
{
  const keep = foundry.utils.fetchJsonWithTimeout;
  foundry.utils.fetchJsonWithTimeout = async url => JSON.parse(read("races", String(url).split("/races/")[1]));
  await RACES.loadRaces();
  foundry.utils.fetchJsonWithTimeout = keep;
}

/** A Racial Trait's Item, as adding it makes one. */
const traitItem = (id, n) => ({ id: `r${n}`, uuid: `A.r${n}`, type: "racial", name: getTrait(id).name, flags: { "dbu-ttrpg": { sourceId: id } },
  system: { script: getTrait(id).script, chosen: [] } });

/** A Zooner with these Items, prepared - with that much Focus Fatigue, at that share of its Life Points. */
function zooner(items, { fatigue = 0, lifeShare = 1 } = {}) {
  const parent = new ActorStub({}, { strict: false });
  Object.assign(parent, { type: "character", items, getFlag: () => undefined, uuid: "A.z", id: "z", documentName: "Actor" });
  const make = life => {
    const model = new DBUCharacterData({ powerLevel: 10, race: "zooner", ...(fatigue ? { resources: { focusfatigue: { stacks: fatigue } } } : {}),
      ...(life === null ? {} : { life: { value: life } }) }, { strict: false, parent });
    parent.system = model;
    model.prepareBaseData?.();
    model.prepareDerivedData();
    return model;
  };
  const first = make(null);
  return (lifeShare === 1) ? first : make(Math.floor(first.life.max * lifeShare));
}
const add = (model, key) => Number(model.effects.slots[key]?.add) || 0;

// --- The race and the Traits ---------------------------------------------------------------------------------------------------
{
  const race = RACES.getRace("zooner");
  check("the Zooners: Agility, Force and Insight +1; Life Modifier 0; Impulsive; 2 Skill Ranks; Small to Large; a Minion Race",
    [race.attributeIncrease, race.lifeModifier, race.savingThrow, race.skillRanks, race.sizes, race.minionRace],
    [{ agility: 1, force: 1, insight: 1 }, 0, "impulsive", 2, ["small", "medium", "large"], true]);
  const row = id => { const t = getTrait(id); return [t.owner, t.category, t.importance, Number(t.order), compile(t.script).errors.length,
    compile(t.script).program.blocks.filter(b => b.mode !== "passive").map(b => `${b.mode}/${b.moment}`)]; };
  check("Reinforced Suit (Body, Primary) and Nice Shooting (Mind, Primary) - compiling; the Healing Surge, an Opponent Defeated",
    [row("reinforced-suit"), row("nice-shooting")],
    [["zooner", "body", "primary", 1, 0, ["triggered/healing-surge"]], ["zooner", "mind", "primary", 2, 0, ["triggered/defeat-opponent"]]]);
  const suit = getTrait("reinforced-suit");
  check("Reinforced Suit: the Suit its Natural Armor, Joint Protection and Spiked on it in no Slot - both real Qualities",
    [suit.naturalArmor, suit.naturalArmorQuality, Boolean(getTrait("joint-protection")), Boolean(getTrait("spiked")),
     read("module", "racial.mjs").includes("if (trait.naturalArmor) for (const quality of listOf(trait.naturalArmorQuality)) await platingQuality(actor, item, quality, true);")],
    ["Suit", ["joint-protection", "spiked"], true, true, true]);
}

// --- Nice Shooting ---------------------------------------------------------------------------------------------------------------
{
  const plain = zooner([traitItem("nice-shooting", 0)]);
  const tired = zooner([traitItem("nice-shooting", 0)], { fatigue: 2 });
  check("(3) Awareness, Defense Value and Soak Value 1(bT) lower a stack of Focus Fatigue; none without",
    [add(plain, "awareness"), add(tired, "awareness"), add(tired, "defenseValue"), add(tired, "soakValue"), getTrait("nice-shooting").resource],
    [0, -2 * tired.baseTierOfPower, -2 * tired.baseTierOfPower, -2 * tired.baseTierOfPower, "focusfatigue"]);
  const door = { id: "signature-technique", usageLimit: { amount: 1, per: "round" } };
  const user = slots => ({ system: { usedManeuvers: ["round:signature-technique"], effects: { slots } }, items: [] });
  check("(4) the Signature Technique Maneuver any number of times a Round - only it",
    [M.maneuverUsesLeft(user({}), door), M.maneuverUsesLeft(user({ "niceShooting.unlimited": true }), door),
     M.maneuverUsesLeft(user({ "niceShooting.unlimited": true }), { id: "surge", usageLimit: { amount: 1, per: "round" } })],
    [0, Infinity, 1]);
}

// --- Wired --------------------------------------------------------------------------------------------------------------------
{
  const CH = read("module", "chat.mjs"), UM = read("module", "use-maneuver.mjs"), NA = read("module", "natural-armor.mjs");
  check("wired: the Suit's Break Value for an Energy Charge once a Round; Nice Shooting's Charge asked, its Focus Fatigue as the attack is done",
    [CH.includes("if (!reflecting && (actor.system.effects?.slots?.[\"suit.charge\"] === true) && (actor.getFlag?.(SCOPE, \"suitChargeRound\") !== roundKey())) {"),
     CH.includes("&& await natural.spendNaturalArmorBreak(actor)) {"),
     NA.includes("await item.update({ \"system.crafted.breakLost\": (Number(item.system.crafted?.breakLost) || 0) + 1 });"),
     UM.includes("answers.earthlingCharge = [].concat(answers.earthlingCharge || [], \"Nice Shooting\");"),
     UM.includes("answers.niceFatigue = (Number(declared.niceFatigue) || 0) + 1;"),
     CH.includes("...(fatigue ? { niceFatigue: fatigue } : {}),"),
     CH.includes("await setResource(attacker, \"focusfatigue\", (Number(attacker.system.resources?.focusfatigue?.stacks) || 0) + Number(attack.niceFatigue));")],
    Array(7).fill(true));
}

// --- Raised Gravity and Shooting Mindset -------------------------------------------------------------------------------------------
{
  const row = id => { const t = getTrait(id); return [t.owner, t.category, t.importance, Number(t.order), compile(t.script).errors.length,
    compile(t.script).program.blocks.filter(b => b.mode !== "passive").map(b => `${b.mode}/${b.moment}${b.modifiers?.outOfSequence ? "+oos" : ""}`)]; };
  check("Raised Gravity (Body) and Shooting Mindset (Mind), Secondary - compiling; the Power Up's Movement out of sequence; Injured's Ki",
    [row("raised-gravity"), row("shooting-mindset"), getTrait("shooting-mindset").script.includes('requires knockedThrough("injured") && hasResource("focusfatigue");')],
    [["zooner", "body", "secondary", 3, 0, ["triggered/power+oos"]], ["zooner", "mind", "secondary", 4, 0, ["triggered/threshold"]], true]);
  const items = [traitItem("raised-gravity", 0), traitItem("shooting-mindset", 1)];
  const well = zooner(items), hurt = zooner(items, { lifeShare: 0.45 });
  const T = well.tierOfPower;
  check("Healthy: Speed, Defense Value and Awareness 1(T); the Energy Charges a Category up; the Signature's Wound 2(T) - none below Healthy",
    [add(well, "speed.normal"), add(well, "defenseValue"), add(well, "awareness"), add(well, "charges.category"), add(well, "wound.signature"),
     add(hurt, "speed.normal"), add(hurt, "charges.category"), add(hurt, "wound.signature"), hurt.threshold.key !== "healthy"],
    [T, T, T, 1, 2 * T, 0, 0, 0, true]);
  const CH = read("module", "chat.mjs");
  check("wired: no Damage, the Signature Technique Maneuver offered once a Round (a Technique offer honours its round flag); the Power Up's Movement "
    + "and its claim; the next attack's Strike; the Called Shot's Focus Fatigue; the Charges' Category; Focus Fatigue off for Ki",
    [CH.includes("    offerGravityTechnique(message, target, attacker);"),
     CH.includes("if (own.hit && (damage <= 0) && armsUser && (armsUser.uuid !== target.uuid)) offerGravityTechnique(message, target, armsUser);"),
     CH.includes("if (used && offer.grants?.roundFlag) await requestActorUpdate(actor, { [`flags.${SCOPE}.${offer.grants.roundFlag}`]: roundKey() });"),
     CH.includes("return (await useManeuver(actor, { ...movement, gravityMove: true }, { outOfSequence: true })) ? undefined : UNSPENT;"),
     CH.includes("if (maneuver?.movement && card && maneuver.gravityMove) {"),
     CH.includes("if (offer.move.gravity && !await gravityBeside(actor)) return;"),
     CH.includes("strikeExtra = [...strikeExtra, { label: \"Raised Gravity\", written: \"+1(T)\", value: mimicTier }];"),
     CH.includes("const fatigue = (reflecting ? 0 : (Number(niceFatigue) || 0)) + (mindsetCalled ? 1 : 0);"),
     CH.includes("...((zoonerCalled || mindsetCalled) ? { zoonerCalled: true } : {}),"),
     CH.includes("+ (Number(actor.system.effects?.slots?.[\"charges.category\"]?.add) || 0)"),
     CH.includes("await requestActorUpdate(actor, { \"system.ki.value\": ki.value - off * each, \"system.capacity.spent\": capacity.spent + off * each });")],
    Array(11).fill(true));
}

console.log(failed ? `\n${failed} failing` : "\n0 failing");
