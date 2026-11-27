// The Elemental AoE sentence, Elemental Blade, and two Profiles that mark the Squares.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.argv[2];
const APP = (process.env.FOUNDRY_APP || String.raw`C:\Program Files\Foundry Virtual Tabletop\resources\app`);
const appUrl = p => pathToFileURL(path.join(APP, p)).href;
const modUrl = p => pathToFileURL(path.join(ROOT, "module", p)).href;
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), "utf8");

globalThis.CONST = {};
globalThis.foundry = {};
await import(appUrl("common/primitives/_module.mjs"));
globalThis.foundry.utils = { ...await import(appUrl("common/utils/_module.mjs")) };
globalThis.ui = { notifications: { warn: () => {}, error: () => {}, info: () => {} } };
globalThis.Handlebars = { escapeExpression: text => String(text) };
const TRAITS = path.join(ROOT, "traits");
globalThis.foundry.utils.fetchJsonWithTimeout = async () => JSON.parse(fs.readFileSync(path.join(TRAITS, "index.json"), "utf8"));
globalThis.fetch = async url => {
  const file = path.join(TRAITS, String(url).replace("systems/dbu-ttrpg/traits/", ""));
  return fs.existsSync(file) ? { ok: true, text: async () => fs.readFileSync(file, "utf8") } : { ok: false };
};
const traits = await import(modUrl("effects/traits.mjs"));
await traits.loadTraits();
const M = await import(modUrl("maneuvers.mjs"));
const T = await import(modUrl("technique.mjs"));
const { withGranted } = await import(modUrl("signature.mjs"));
const { PROFILES, SUPER_PROFILES } = M;

let failed = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`);
};
function source(text, name) {
  const at = text.search(new RegExp(`(export )?(async )?function ${name}\\(`));
  if (at < 0) return "";
  const next = text.slice(at + 1).search(/\n(export )?(async )?function |\n\/\*\*/);
  return (next < 0 ? text.slice(at) : text.slice(at, at + 1 + next)).replace(/^export /, "");
}
const CHAT = read("module", "chat.mjs");
const USE = read("module", "use-maneuver.mjs");

// --- Which Profile marks the Squares ------------------------------------------------------------------
{
  const squareRider = new Function("PROFILES",
    `${source(CHAT, "secondProfileOf")}; ${source(CHAT, "extraProfilesOf")}; ${source(CHAT, "compressedOn")}; ${source(CHAT, "squareRider")}; return squareRider;`)(PROFILES);
  check("one Profile: its own", squareRider({ profile: "elementalFire" })?.label, "Elemental (Fire)");
  check("two that mark: the one the player picked",
    squareRider({ profile: "elementalFire", technique: { secondProfile: "elementalIce", features: [] }, markFrom: "elementalIce" })?.label,
    "Elemental (Ice)");
  check("an Elemental Blade's second Profile on an ordinary attack counts",
    squareRider({ profile: "simple", secondProfile: "elementalWater" })?.label, "Elemental (Water)");
  check("a pick that is not on the attack is ignored",
    squareRider({ profile: "elementalFire", markFrom: "elementalIce" })?.label, "Elemental (Fire)");
  check("Compressed Element leaves none, from the Technique or from the Weapon",
    [squareRider({ profile: "elementalFire", technique: { features: ["compressed-element"] } }),
     squareRider({ profile: "elementalFire", compressedElement: true })], [null, null]);
  check("Metal's Area makes its Squares Metallic and Dangerous", PROFILES.elementalMetal.areaSquareQualities,
    ["metallic", "dangerous"]);
  check("and both Qualities exist", ["metallic", "dangerous"].map(id => Boolean(traits.getTrait(id))), [true, true]);
  check("no Profile waits on the AoE sentence any more", Object.values(PROFILES).filter(p => p.needs).length, 0);
}

// --- Elemental Blade ------------------------------------------------------------------------------------
{
  const trait = traits.getTrait("elemental-blade");
  const offered = String(trait?.choices ?? "").split(",").map(entry => entry.split("=")[0].trim()).filter(Boolean);
  check("its choice is every Profile with 'Elemental' in the name",
    offered.sort(), Object.keys(PROFILES).filter(id => PROFILES[id].label.includes("Elemental")).sort());
  check("the Weapon says which", read("module", "gear.mjs")
    .includes('elementalBlade: qualityEntries(crafted).find(entry => entry.id === "elemental-blade")?.choice ?? "",'), true);

  let answer = "blade";
  let asked = [];
  globalThis.foundry.applications = { api: { DialogV2: { wait: async options => {
    asked.push(options.buttons.map(button => button.action));
    return (options.buttons.some(button => button.action === answer)) ? answer : options.buttons[0].action;
  } } } };
  // The wager asked again is its own function, tested below; here it only says it was asked.
  const wagered = [];
  const wagerAgain = async (who, maneuver, before, declared, second) => { wagered.push(second); return declared; };
  const blade = new Function("PROFILES", "SUPER_PROFILES", "superProfileKiPerTier", "signatureFeature", "requirementHolds",
    "withGranted", "wagerAgain", `${source(USE, "elementalBlade")}; return elementalBlade;`)(
    PROFILES, SUPER_PROFILES, T.superProfileKiPerTier, T.featureDef, T.requirementHolds, withGranted, wagerAgain);
  const actor = { system: { tierOfPower: 3 } };
  const weapon = profile => ({ name: "Sword", elementalBlade: profile });

  let out = await blade(actor, { name: "Basic Attack" }, { profile: "simple", advantages: [], weapon: weapon("elementalFire") });
  check("an ordinary attack becomes Multi-Profile with the chosen Elemental",
    [out.maneuver.superProfile, out.maneuver.secondProfile], ["multi-profile", "elementalFire"]);
  check("and pays Multi-Profile's KP at the attacker's Tier",
    out.declared.multiProfileKi, T.superProfileKiPerTier("multi-profile", "elementalFire") * 3);
  check("Compressed Element, since Fire is one it names", out.declared.compressedElement, true);
  out = await blade(actor, { name: "Basic Attack" }, { profile: "simple", advantages: [], weapon: weapon("elementalWind") });
  check("not for one it does not name", out.declared.compressedElement ?? false, false);
  out = await blade(actor, { name: "Basic Attack" }, { profile: "simple", advantages: [], weapon: weapon("elementalLight") });
  check("what the second Profile hands out comes with it", out.declared.advantages, ["full-wager"]);
  check("and the wager is looked at again", wagered.at(-1), "elementalLight");
  out = await blade(actor, { name: "Basic Attack" }, { profile: "elementalFire", advantages: [], weapon: weapon("elementalFire") });
  check("the same Elemental as the attack's still applies (the table's ruling)",
    [out.maneuver.secondProfile, out.declared.multiProfileKi > 0], ["elementalFire", true]);

  asked = [];
  answer = "own";
  out = await blade(actor, { name: "Big Bang", superProfile: "karmic" }, { profile: "blast", advantages: [], weapon: weapon("elementalIce") });
  check("a Technique with a Super Profile of its own is asked, and may keep it",
    [asked[0], out.maneuver.superProfile, out.declared.multiProfileKi ?? 0], [["own", "blade", "cancel"], "karmic", 0]);
  answer = "blade";
  out = await blade(actor, { name: "Big Bang", superProfile: "karmic" }, { profile: "blast", advantages: [], weapon: weapon("elementalIce") });
  check("or take the Blade's, paying the difference",
    [out.maneuver.superProfile, out.declared.multiProfileKi],
    ["multi-profile", (T.superProfileKiPerTier("multi-profile", "elementalIce") - T.superProfileKiPerTier("karmic", "")) * 3]);
  answer = "cancel";
  check("and putting the question away stops the attack",
    await blade(actor, { name: "Big Bang", superProfile: "karmic" }, { profile: "blast", advantages: [], weapon: weapon("elementalIce") }),
    null);

  asked = [];
  answer = "elementalIce";
  out = await blade(actor, { name: "Basic Attack" }, { profile: "elementalFire", advantages: [], weapon: weapon("elementalIce") });
  check("two Profiles that mark the Squares: the player picks whose", [asked.at(-1), out.declared.markFrom],
    [["elementalFire", "elementalIce", "cancel"], "elementalIce"]);
  asked = [];
  out = await blade(actor, { name: "Basic Attack" }, { profile: "elementalFire", advantages: [], weapon: weapon("elementalWind") });
  check("one that marks and one that does not: nothing to pick", [asked.length, out.declared.markFrom ?? ""], [0, ""]);
  out = await blade(actor, { name: "Basic Attack" }, { profile: "simple", advantages: [] });
  check("no Blade, nothing changes", [out.maneuver.superProfile ?? "", out.declared.multiProfileKi ?? 0], ["", 0]);

  const kiCost = M.maneuverKiCost;
  const basic = M.getManeuver("basic-attack") ?? { id: "basic-attack", attacking: true, kiCost: 0 };
  const who = { system: { tierOfPower: 1, baseTierOfPower: 1, effects: { slots: {} } } };
  check("Multi-Profile's KP is in the price",
    kiCost(basic, { profile: "simple", multiProfileKi: 6 }, who) - kiCost(basic, { profile: "simple" }, who), 6);
}

// --- Karmic Assault -----------------------------------------------------------------------------------
{
  // karma.mjs brings the data models with it; its two functions stand in, off the real file.
  const trait = traits.getTrait("karmic-assault");
  const karma = {
    allKarmicEffects: () => [{ key: "karmic-assault", name: trait.name, cost: Number(trait.cost), text: trait.text }],
    spendKarma: async (who, effect) => {
      if ((who.system.karma ?? 0) < effect.cost) return null;
      await who.update({ "system.karma": who.system.karma - effect.cost });
      return effect.cost;
    }
  };
  let answer = { id: "cataclysmic-attack", second: "" };
  let asked = 0;
  globalThis.foundry.applications = { api: { DialogV2: { wait: async () => { asked++; return answer; } } } };
  const posted = [];
  globalThis.ChatMessage = { create: async data => posted.push(data.content), getSpeaker: () => ({}) };
  const body = source(USE, "karmicAssault").replace('await import("./karma.mjs")', "karmaModule");
  const again = [];
  const assault = new Function("PROFILES", "SUPER_PROFILES", "superProfileKiPerTier", "withGranted", "karmaModule", "wagerAgain", "karmaAvailable",
    `${body}; return karmicAssault;`)(PROFILES, SUPER_PROFILES, T.superProfileKiPerTier, withGranted, karma,
    async (who, maneuver, before, declared, second) => { again.push(second); return declared; }, who => Number(who?.system?.karma) || 0);
  const actor = (points = 5) => {
    const who = { name: "Goku", system: { karma: points, tierOfPower: 2 } };
    who.update = async data => { who.system.karma = data["system.karma"]; };
    return who;
  };
  const ultimate = { name: "Spirit Bomb", signature: true, ultimate: true, superProfile: "" };
  const declared = { profile: "blast", advantages: [] };

  let who = actor();
  let out = await assault(who, ultimate, declared);
  check("an Ultimate: the Super Profile chosen goes on the attack",
    [out.maneuver.superProfile, out.declared.karmicAssault], ["cataclysmic-attack", "cataclysmic-attack"]);
  check("its KP paid at the attacker's Tier", out.declared.superProfileKi, SUPER_PROFILES["cataclysmic-attack"].kiCostPerTier * 2);
  check("nothing is spent yet: the Karma waits for the attack to be made", who.system.karma, 5);
  const pay = new Function("PROFILES", "SUPER_PROFILES", "karmaModule",
    `${source(USE, "payKarmicAssault").replace('await import("./karma.mjs")', "karmaModule")}; return payKarmicAssault;`)(
    PROFILES, SUPER_PROFILES, karma);
  check("made, it is paid", [await pay(who, out.maneuver, out.declared), who.system.karma], [true, 3]);
  const none = actor();
  check("an attack without it pays nothing", [await pay(none, ultimate, declared), none.system.karma], [false, 5]);
  check("paid once the card exists, and only then",
    USE.indexOf("if (card) await payKarmicAssault(actor, maneuver, declared);")
      > USE.indexOf("await recordManeuverType(actor, outOfSequence ? \"outOfSequence\" : maneuver.type"), true);
  asked = 0;
  out = await assault(actor(), { ...ultimate, ultimate: false, ascended: true }, declared);
  check("an Ascended Super counts as an Ultimate for it", [asked, out.maneuver.superProfile], [1, "cataclysmic-attack"]);
  asked = 0;
  out = await assault(actor(), { ...ultimate, superProfile: "karmic" }, declared);
  check("not on one that already has a Super Profile", [asked, out.maneuver.superProfile], [0, "karmic"]);
  asked = 0;
  out = await assault(actor(), { ...ultimate, ultimate: false }, declared);
  check("nor on a Super", [asked, out.maneuver.superProfile], [0, ""]);
  asked = 0;
  out = await assault(actor(1), ultimate, declared);
  check("nor without the Karma to pay for it", asked, 0);
  answer = { id: "", second: "" };
  who = actor();
  out = await assault(who, ultimate, declared);
  check("None spends nothing", [out.maneuver.superProfile, who.system.karma], ["", 5]);
  answer = { id: "multi-profile", second: "elementalLight" };
  out = await assault(actor(), ultimate, declared);
  check("Multi-Profile takes its second Profile, and what it hands out",
    [out.maneuver.secondProfile, out.declared.advantages, out.declared.superProfileKi],
    ["elementalLight", ["full-wager"], T.superProfileKiPerTier("multi-profile", "elementalLight") * 2]);
  check("and Multi-Profile looks at the wager again", again, ["elementalLight"]);
  answer = "cancel";
  check("putting it away stops the attack", await assault(actor(), ultimate, declared), null);
  const kiCost = M.maneuverKiCost;
  const basic = M.getManeuver("basic-attack") ?? { id: "basic-attack", attacking: true, kiCost: 0 };
  const plain = { system: { tierOfPower: 1, baseTierOfPower: 1, effects: { slots: {} } } };
  check("its KP is in the price",
    kiCost(basic, { profile: "simple", superProfileKi: 8 }, plain) - kiCost(basic, { profile: "simple" }, plain), 8);
  const KARMA = read("module", "karma.mjs");
  check("the Respond dialog shows it greyed, saying where it is taken",
    [KARMA.includes("else if (effect.takenAt) blocked = effect.takenAt;"), trait.takenAt, trait.cost],
    [true, "offered when an Ultimate Signature Technique is declared", 2]);
  check("asked before the Technique's own questions",
    USE.indexOf("const assaulted = await karmicAssault(actor, maneuver, declared);")
      < USE.indexOf("const asked = await askTechniqueDeclaration(actor, maneuver, declared, targetActor);"), true);
}

// --- The wager, asked again -------------------------------------------------------------------------
{
  let reply = { amount: 30, fromLife: false };
  let opened = 0;
  globalThis.foundry.applications = { api: { DialogV2: { wait: async () => { opened++; return reply; } } } };
  const wagerAgain = new Function("PROFILES", "maxKiWager", "maxLifeWager", "forcedFullWager", "minimumKiWager",
    `${source(USE, "wagerAgain")}; return wagerAgain;`)(PROFILES, M.maxKiWager, M.maxLifeWager, M.forcedFullWager,
    () => 0);
  const who = { system: { capacity: { max: 40, remaining: 40 }, ki: { value: 100 }, life: { value: 50 },
    effects: { slots: {} } } };
  const maneuver = { name: "Kamehameha" };
  let out = await wagerAgain(who, maneuver, { advantages: [] },
    { profile: "simple", advantages: ["full-wager"], kiWager: 10 }, "elementalLight");
  check("Full Wager brought by the second Profile: asked again, up to the new ceiling",
    [opened, out.kiWager], [1, Math.min(30, M.maxKiWager(who, ["full-wager"]))]);
  reply = { amount: 999, fromLife: false };
  out = await wagerAgain(who, maneuver, { advantages: [] },
    { profile: "simple", advantages: ["full-wager"], kiWager: 10 }, "elementalLight");
  check("and never past it", out.kiWager, M.maxKiWager(who, ["full-wager"]));
  opened = 0;
  out = await wagerAgain(who, maneuver, { advantages: ["full-wager"] },
    { profile: "simple", advantages: ["full-wager"], kiWager: 10 }, "elementalLight");
  check("not when it had Full Wager already", [opened, out.kiWager], [0, 10]);
  opened = 0;
  out = await wagerAgain(who, maneuver, { advantages: [] }, { profile: "simple", advantages: [], kiWager: 10 }, "elementalFire");
  check("not for a Profile that changes nothing about it", opened, 0);
  reply = { amount: 12, fromLife: true };
  out = await wagerAgain(who, maneuver, { advantages: [] }, { profile: "simple", advantages: [], kiWager: 4 }, "elementalDark");
  check("Elemental (Dark): the Life wager offered", [out.kiWager, out.wagerFromLife], [12, true]);
  reply = "cancel";
  out = await wagerAgain(who, maneuver, { advantages: [] }, { profile: "simple", advantages: ["full-wager"], kiWager: 7 },
    "elementalLight");
  check("put away, the wager stays as it was", out.kiWager, 7);
}

// --- Deleting a Technique ----------------------------------------------------------------------------
{
  const SHEET = read("module", "sheets", "actor-character-sheet.mjs");
  check("its Imminent marks go with it",
    SHEET.includes('const marks = (target.getFlag?.("dbu-ttrpg", "imminent") ?? []).filter(mark => mark.itemId !== item.id);'),
    true);
}

// --- The AoE sentence, on the card --------------------------------------------------------------------
{
  const mark = source(CHAT, "markArea");
  check("everyone the attack was made against, hit or not",
    mark.includes("if (!attack.areaMarked) who = attackTargets(attack).map(entry => fromUuidSync(entry.uuid)).filter(Boolean);"), true);
  check("and whoever else the attacker says stands in it", mark.includes("Who else stands in the"), true);
  check("the empty Squares said on the card", mark.includes("Empty Squares are the"), true);
  const apply = source(CHAT, "applyAttackDamage");
  check("marked with the Damage, once",
    apply.includes("if (attacker && attackArea(attack) && squareRider(attack) && !attack.areaMarked) await markArea(message, attack);"),
    true);
  check("the per-target mark only without an Area",
    apply.includes("if (riders.squareMark && !attackArea(attack)) {"), true);
  check("both Profiles' Threshold effects",
    apply.includes("for (const id of [...new Set([attack.profile, ...extraProfilesOf(attack)].filter(Boolean))]) {"), true);
  check("a button for the attacker once the Wound is rolled", CHAT.includes(": mark the Area`"), true);
  check("out of sequence too", CHAT.includes("const bladed = await elementalBlade(actor, maneuver, declared);\n    if (!bladed) return;"),
    true);
  check("and in sequence", USE.includes("const bladed = await elementalBlade(actor, maneuver, declared);\n    if (!bladed) return false;"),
    true);
}

console.log(`\n${failed} failing`);
process.exit(failed ? 1 : 0);
