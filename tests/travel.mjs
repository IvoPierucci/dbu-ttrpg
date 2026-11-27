// Travel: the Ki Points each Type costs, and the button that takes them.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.argv[2];
const modUrl = p => pathToFileURL(path.join(ROOT, "module", p)).href;
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), "utf8");

let failed = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`);
};

const { TRAVEL_TYPES, travelKiLoss } = await import(modUrl("adventure.mjs"));
check("three Types", Object.keys(TRAVEL_TYPES), ["short", "medium", "long"]);
const loss = options => travelKiLoss({ maxKi: 95, flightRanks: 2, ...options }).loss;
check("Short: nothing; Medium: 1/10, down; Long: 1/4, down",
  [loss({ type: "short" }), loss({ type: "medium" }), loss({ type: "long" })], [0, 9, 23]);
check("under 2 Ranks in Flight: doubled",
  [loss({ type: "medium", flightRanks: 1 }), loss({ type: "long", flightRanks: 0 })], [18, 46]);
check("by Vehicle, or rested on the way: nothing, whatever the Type or Flight",
  [loss({ type: "long", vehicle: true, flightRanks: 0 }), loss({ type: "medium", rested: true })], [0, 0]);
check("the reason said",
  [travelKiLoss({ type: "long", maxKi: 40, flightRanks: 0 }).reason, travelKiLoss({ type: "long", vehicle: true }).reason],
  ["1/4 of their Maximum Ki Points, doubled - under 2 Ranks in Flight", "by Vehicle"]);

const SHEET = read("module", "sheets", "actor-character-sheet.mjs");
const TAB = read("templates", "parts", "actor-adventure.hbs");
check("a Travel button on the Adventure tab, wired",
  [TAB.includes('data-action="travel"'), SHEET.includes("travel: DBUCharacterSheet._onTravel,")], [true, true]);
check("never below 0: what is lost is what there was",
  SHEET.includes("const lost = Math.min(loss, Math.max(0, Number(ki.value) || 0));"), true);
check("Flight Ranks read off the character",
  SHEET.includes("flightRanks: this.actor.system.skills?.flight?.ranks ?? 0 });"), true);

// --- Adventuring Maneuvers ------------------------------------------------------------------------
{
  const { parseTraitFile } = await import(modUrl("effects/traits.mjs"));
  const { adventuringManeuvers, whyNotAdventuring, regainedShare } = await import(modUrl("adventure.mjs"));
  const file = name => ({ ...parseTraitFile(read("traits", "adventuring", `${name}.dbu`), `adventuring/${name}.dbu`) });
  const breather = file("take-a-breather");
  const rest = file("rest");
  const printed = definition => String(definition.text ?? "").trim().split(/\s*(?=–)/);
  check("Take a Breather, as printed", printed(breather), [
    "Take a Breather: You take the time to regain some stamina.",
    "–Prerequisite: N/A", "–Session Limit: 1", "–Time Cost: 1 Hour",
    "–Effect: Regain Life and Ki Points equal to 1/10th of their respective maximums."]);
  check("Rest, as printed", printed(rest), [
    "Rest: With a full night’s rest, you feel refreshed and ready to go.",
    "–Prerequisite: N/A", "–Session Limit: 1", "–Time Cost: 8 Hours",
    "–Effect: Regain Life and Ki Points equal to half of their respective maximums."]);
  const INDEX_A = JSON.parse(read("traits", "index.json"));
  check("both in the index, in a kind of their own",
    [INDEX_A.traits.includes("adventuring/take-a-breather.dbu"), INDEX_A.traits.includes("adventuring/rest.dbu"),
     read("module", "effects", "traits.mjs").includes('adventuring: { label: "Adventuring Maneuver", priority: PRIORITY.base },')],
    [true, true, true]);

  const listed = adventuringManeuvers([rest, breather], ["rest"]);
  check("possessed by all: each with its Time Cost and what is left of its Session Limit",
    listed.map(({ id, timeCost, limit, left }) => [id, timeCost, limit, left]),
    [["rest", "8 Hours", 1, 0], ["take-a-breather", "1 Hour", 1, 1]]);
  check("refused in a Combat Encounter, and past the Session Limit; otherwise free",
    [whyNotAdventuring(listed[1], { adventuring: false }), whyNotAdventuring(listed[0]), whyNotAdventuring(listed[1])],
    ["Only outside a Combat Encounter.", "Its Session Limit (1) is reached this Adventuring Session.", null]);
  check("a tenth, and half, of each maximum - down, and never past it",
    [regainedShare(10, { life: { value: 10, max: 95 }, ki: { value: 0, max: 47 } }),
     regainedShare(2, { life: { value: 90, max: 95 }, ki: { value: 0, max: 47 } })],
    [{ life: 9, ki: 4 }, { life: 5, ki: 23 }]);
  check("the shares in the files", [breather.regainShare, rest.regainShare].map(Number), [10, 2]);

  const DATA = read("module", "data", "actor-character.mjs");
  const CHAT = read("module", "chat.mjs");
  check("uses kept on the actor, emptied only by New Session",
    [DATA.includes("schema.adventureUses = new fields.ArrayField("),
     SHEET.includes('return this.actor.update({ "system.adventureUses": [] });'),
     (SHEET.match(/"system\.adventureUses": \[\]/g) ?? []).length], [true, true, 1]);
  check("the attempt counts at once; the benefits wait on the card's button",
    [SHEET.includes('await this.actor.update({ "system.adventureUses": [...uses, entry.id] });'),
     CHAT.includes("  renderAdventuring(message, html);"),
     CHAT.includes("const back = regainedShare(adventuring.share, actor.system);")], [true, true, true]);
  // --- Stretch
  const stretch = file("stretch");
  check("Stretch, as printed", printed(stretch), [
    "Stretch: You limber up for battle, stretching your muscles to prepare for the rigors of strenuous combat.",
    "–Prerequisite: 2+ Skill Ranks in Acrobatics", "–Session Limit: 1", "–Time Cost: 2 Minutes",
    "–Effect: If you enter a Combat Encounter within the next hour, increase your Combat Rolls by 1(T) "
      + "for the first 3 Combat Rounds of that Combat Encounter."]);
  const offered = ranks => adventuringManeuvers([breather, stretch], [], { skills: { acrobatics: { ranks } } })
    .map(entry => entry.id);
  check("offered with 2+ Ranks in Acrobatics, not with 1",
    [offered(1), offered(2)], [["take-a-breather"], ["take-a-breather", "stretch"]]);
  const stretched = { ...parseTraitFile(read("traits", "conditions", "stretched.dbu"), "conditions/stretched.dbu") };
  check("it leaves the Stretched mark: ended by hand, the first 3 Rounds",
    [stretch.gains, stretched.maxStacks, stretched.endedByHand, stretched.firstRounds].map(String),
    ["stretched", "1", "true", "3"]);
  check("Combat Rolls 1(T) better, only out of Adventuring",
    /if \(!adventuring\) \{\s*combatRolls \+= 1\(T\);\s*\}/.test(stretched.script ?? read("traits", "conditions", "stretched.dbu")), true);
  const COMBAT = read("module", "combat.mjs");
  check("entering: a Round clock one edge past the Rounds, before the first Round counts; leaving: gone",
    [COMBAT.includes("await lasting(actor, { kind: KINDS.CONDITION, key: trait.id, edge: EDGES.ROUND, extra: rounds,"),
     COMBAT.indexOf("await firstRoundsBegin(actor);") > 0,
     COMBAT.indexOf("await startEncounter(combat);") < COMBAT.indexOf("await startRound(combat);"),
     COMBAT.includes("await firstRoundsEnd(actor);")], [true, true, true, true]);
  check("the card gives the mark", CHAT.includes("await gainCondition(actor, adventuring.gains, 1);"), true);
  const buffed = held => adventuringManeuvers([stretch], [],
    { skills: { acrobatics: { ranks: 2 } }, conditions: { stretched: held } })[0].buffed;
  check("Cancel buff on its row while the mark is held, and not otherwise",
    [buffed(1), buffed(0), TAB.includes('data-action="cancelAdventuringBuff"'),
     SHEET.includes("cancelAdventuringBuff: DBUCharacterSheet._onCancelAdventuringBuff,")], [true, false, true, true]);
  check("cancelled: the mark off, and its clock",
    [SHEET.includes("const kept = timed.filter(entry => !((entry.kind === \"condition\") && (entry.key === key)));"),
     SHEET.includes("await setCondition(this.actor, key, 0);\n  }")], [true, true]);
  check("both in the index",
    [INDEX_A.traits.includes("adventuring/stretch.dbu"), INDEX_A.traits.includes("conditions/stretched.dbu")], [true, true]);

  // --- Pickpocket
  const pickpocket = file("pickpocket");
  const { targetPenalty } = await import(modUrl("adventure.mjs"));
  check("Pickpocket, as printed", printed(pickpocket), [
    "Pickpocket: You snatch something that does not belong to you from another person’s pocket, pouch, or pack.",
    "–Prerequisite: 2+ Skill Ranks in Thievery", "–Session Limit: Infinite", "–Time Cost: 1 Minute",
    "–Effect: Target a Character. Make a Clash (Thievery vs Perception/Thievery) against that Character. "
      + "If you win, you may steal a Basic Item that belongs to that Character. Each time you target a "
      + "Character with this Adventuring Maneuver during an Adventuring Session, reduce the Dice Score of "
      + "your Thievery Skill against that Character by 3 for any subsequent checks made through the "
      + "Pickpocket Maneuver."]);
  const thief = adventuringManeuvers([pickpocket], ["pickpocket@A", "pickpocket@A", "pickpocket@B"],
    { skills: { thievery: { ranks: 2 } } })[0];
  check("with 2+ Ranks in Thievery; no Session Limit, never reached",
    [thief?.limit, thief?.left, whyNotAdventuring(thief)], [null, null, null]);
  check("-3 for each earlier attempt on the same Character, and on no other",
    [targetPenalty(["pickpocket@A", "pickpocket@A", "pickpocket@B"], "pickpocket", "A", 3),
     targetPenalty(["pickpocket@A"], "pickpocket", "B", 3), targetPenalty([], "pickpocket", "A", 3)], [6, 0, 0]);
  check("a Clash, Thievery against Perception or Thievery",
    [pickpocket.clashSkill, [].concat(pickpocket.clashDefenderSkills).join(",").split(",").map(s => s.trim()),
     String(pickpocket.targetPenalty), pickpocket.steals], ["thievery", ["perception", "thievery"], "3", "basic"]);
  check("at the one token targeted, the attempt recorded against them, the penalty on the thief's side",
    [SHEET.includes("if (many ? !aimed.length : (aimed.length !== 1)) {"),
     SHEET.includes('await this.actor.update({ "system.adventureUses": [...uses, ...aimed.map(victim => `${entry.id}@${victim.uuid}`)] });'),
     CHAT.includes("...((uuid === clash.challengerUuid) ? (clash.challengerRows ?? []) : [])\n    ],\n\n    criticalDice: () => DBUCharacterData.SKILL_CRITICAL_DIE,")],
    [true, true, true]);
  check("won: one of their Basic Items, picked, changes hands",
    [CHAT.includes("await settlePickpocket(message, clash);"),
     CHAT.includes("await requestCreateItem(thief, data);\n  await requestDeleteItem(victim, item.id);")], [true, true]);
  check("the row shows no limit as infinite", TAB.includes("{{else}}&infin;{{/if}}"), true);
  check("in the index", INDEX_A.traits.includes("adventuring/pickpocket.dbu"), true);

  {
    const at = SHEET.indexOf("static async _onNewAdventureSession()");
    const body = SHEET.slice(at, SHEET.indexOf("\n  }", at));
    check("New Session: this character's uses emptied, and nothing said in chat",
      [body.includes('return this.actor.update({ "system.adventureUses": [] });'), body.includes("ChatMessage")],
      [true, false]);
  }
  // --- Obscure
  const obscure = file("obscure");
  check("Obscure, as printed", printed(obscure), [
    "Obscure: You hide from view, making yourself much harder for enemies to detect.",
    "–Prerequisite: 2+ Skill Ranks in Stealth", "–Session Limit: Infinite", "–Time Cost: N/A",
    "–Effect: You begin Obscuring your presence, disappearing from sight, often moving to hide behind "
      + "something or otherwise making some distance between you and those present. Make a Clash (Stealth "
      + "vs Perception) against all Characters within your vicinity. Those who lose become unaware of your "
      + "presence, enabling you to initiate a Surprise Round in a Combat Encounter, or learn information you "
      + "would potentially not know if you were around.\n\nMake the Clash against any individuals encountered "
      + "while you are Obscuring yourself, to see if they are aware or unaware of your presence.\n\nWhile you "
      + "are successfully Obscured from any Characters that would become Opponents in an initiated Combat "
      + "Encounter, you can choose not to enter that Combat Encounter, or enter it later on at your whim."]);
  const hider = adventuringManeuvers([obscure], [], { skills: { stealth: { ranks: 2 } } })[0];
  check("with 2+ Ranks in Stealth, no Session Limit; Stealth against Perception, at everyone targeted",
    [hider?.limit, obscure.clashSkill, String(obscure.clashDefenderSkills), obscure.clashTargets, obscure.clashUnaware],
    [null, "stealth", "perception", "many", true]);
  check("a Clash for each Character targeted, never the user",
    [SHEET.includes("for (const victim of aimed) {"), SHEET.includes(".filter(actor => actor.uuid !== this.actor.uuid);")],
    [true, true]);
  check("settled: aware or unaware, said on the card",
    [CHAT.includes("await settleUnaware(message, clash);"), CHAT.includes("is unaware of ${clash.challengerName}.")],
    [true, true]);
  check("in the index", INDEX_A.traits.includes("adventuring/obscure.dbu"), true);

  // --- Tune Up
  const tune = file("tune-up");
  check("Tune Up, as printed", printed(tune), [
    "Tune Up: You repair and upgrade a vehicle, routinely maintaining its form and function.",
    "–Prerequisite: 2+ Skill Ranks in Craft (Vehicles)", "–Session Limit: 1", "–Time Cost: 4 Hours",
    "–Effect: Recreate a Vehicle or Battle Jacket exactly as it was, but with your current Power Level "
      + "and (for Battle Jackets) your Scholarship Score (if its higher than the current Jacket Attribute)."]);
  const crafter = skills => adventuringManeuvers([tune], [], { skills }).length;
  check("offered with 2+ Ranks in Craft (Vehicles) - not in another Craft",
    [crafter({ craftVehicles: { ranks: 2 } }), crafter({ craftVehicles: { ranks: 1 } }), crafter({ craft: { ranks: 3 } })],
    [1, 0, 0]);
  check("what it does is said once the time is spent - Vehicles are not built",
    [String(tune.effectNote).startsWith("recreates a Vehicle or Battle Jacket exactly as it was"),
     CHAT.includes("if (adventuring.note) said.push(`${actor.name} ${adventuring.note.replaceAll(")], [true, true]);
  check("in the index", INDEX_A.traits.includes("adventuring/tune-up.dbu"), true);

  // --- Full Repair
  const full = file("full-repair");
  const { repairSteps, repairedLoss } = await import(modUrl("adventure.mjs"));
  check("Full Repair, as printed", printed(full), [
    "Full Repair: You painstakingly repair damage to your vehicle, replacing damaged parts and ensuring full funtionality.",
    "–Prerequisite: 2+ Skill Ranks in Craft", "–Session Limit: 1", "–Time Cost: 2~10 Hours",
    "–Effect: Select a Vehicle or Battle Jacket. It regains Life and (for the Battle Jacket) Ki Points "
      + "equal to 1/5 of their respective maximums for every 2 hours spent on the Full Repair Maneuver."]);
  check("offered with 2+ Ranks in Craft (Weapons) or Craft (Vehicles) - the Craft of what it repairs",
    [{ craftWeapons: { ranks: 2 } }, { craftVehicles: { ranks: 2 } }, { craft: { ranks: 2 } }, { craftWeapons: { ranks: 1 } }]
      .map(skills => adventuringManeuvers([full], [], { skills }).length), [1, 1, 0, 0]);
  check("and in it, a Weapon only with Craft (Weapons), a Vehicle only with Craft (Vehicles)",
    [SHEET.includes('const weapons = (ranksIn("craftWeapons") >= 2) ?'), SHEET.includes('const vehicles = (ranksIn("craftVehicles") >= 2)\n      ? game.actors.filter(actor => (actor.type === "vehicle") && actor.visible) : [];')],
    [true, true]);
  check("any hour 2 to 10, every full 2 a fifth",
    [2, 3, 5, 10, 1, 14].map(hours => repairSteps(hours)), [1, 1, 2, 5, 1, 5]);
  check("a fifth of the most for each, down, never past whole",
    [repairedLoss({ lifeMax: 42, lifeLost: 30, steps: 2 }), repairedLoss({ lifeMax: 42, lifeLost: 10, steps: 5 })],
    [14, 0]);
  check("the Weapon's Repair on the Gear tab goes through it; a destroyed one comes back",
    [SHEET.includes("return this.#startFullRepair(entry, definition, item.id);"),
     SHEET.includes("if (definition.fullRepair === true) return this.#startFullRepair(entry, definition, \"\");"),
     CHAT.includes("const before = item.system.crafted.destroyed ? lifeMax : (Number(item.system.crafted.lifeLost) || 0);"),
     CHAT.includes("...((lifeLost < lifeMax) ? { \"system.crafted.destroyed\": false } : {}) });")],
    [true, true, true, true]);
  check("in the index", INDEX_A.traits.includes("adventuring/full-repair.dbu"), true);

  // --- Recall
  const recall = file("recall");
  check("Recall, as printed", printed(recall), [
    "Recall: You wrack your memory for relevant information to present to your comrades.",
    "–Prerequisite: 2+ Skill Ranks in Knowledge", "–Session Limit: 1", "–Time Cost: 1 Minute",
    "–Effect: You recall a piece of information related to your chosen Specialty that may help with your "
      + "current situation."]);
  const { knowledgeHeld } = await import(modUrl("adventure.mjs"));
  check("offered with 2+ Ranks in any Knowledge",
    ["knowledge", "knowledgeProfession", "knowledgeHistory"].map(skill =>
      adventuringManeuvers([recall], [], { skills: { [skill]: { ranks: 2 } } }).length)
      .concat(adventuringManeuvers([recall], [], { skills: { knowledge: { ranks: 1 } } }).length), [1, 1, 1, 0]);
  check("which Knowledge: among those with 2+, asked where more than one, and named on the card",
    [knowledgeHeld({ skills: { knowledge: { ranks: 1 }, knowledgeHistory: { ranks: 3 }, knowledgeProfession: { ranks: 2 } } }),
     recall.asksKnowledge, String(recall.effectNote).includes("{knowledge}"),
     CHAT.includes('adventuring.note.replaceAll("{knowledge}", adventuring.knowledge || "Knowledge")')],
    [["knowledgeProfession", "knowledgeHistory"], true, true, true]);
  check("in the index", INDEX_A.traits.includes("adventuring/recall.dbu"), true);

  // --- Research
  const research = file("research");
  check("Research, as printed", printed(research), [
    "Research: You hit the books, determined to learn something that may help with your current predicament.",
    "–Prerequisite: 2+ Skill Ranks in Knowledge", "–Session Limit: 1", "–Time Cost: 2 Hours",
    "–Effect: Select a topic. Make a Knowledge Skill Check with a Difficulty Category decided by your ARC. "
      + "If you succeed, you gain information on that subject that can prove helpful to your current "
      + "circumstance. If you fail, you gain relatively useless information that may hint towards a clue, or "
      + "may not."]);
  check("offered with 2+ Ranks in any Knowledge, which is asked; the topic asked first, and a cancel counts nothing",
    [adventuringManeuvers([research], [], { skills: { knowledgeHistory: { ranks: 2 } } }).length, research.asksTopic,
     SHEET.includes('if (!topic || (topic === "cancel")) return;'),
     SHEET.indexOf('if (!topic || (topic === "cancel")) return;') < SHEET.indexOf('await this.actor.update({ "system.adventureUses": [...uses, entry.id] });')],
    [1, true, true, true]);
  check("the topic on the card; the Check and its outcomes said once the time is spent",
    [CHAT.includes("topic ? ` ${escape(definition.topicWord ?? \"into\")} ${escape(topic)}` : \"\""), CHAT.includes("adventuring.topic ? ` - the topic: ${adventuring.topic}` : \"\""),
     typeof research.effectNote, String(research.effectNote).includes(",")], [true, true, "string", false]);
  check("in the index", INDEX_A.traits.includes("adventuring/research.dbu"), true);

  // --- Care
  const care = file("care");
  const { caredFor } = await import(modUrl("adventure.mjs"));
  check("Care, as printed", printed(care), [
    "Care: You provide extensive medical intervention for someone who has been injured.",
    "–Prerequisite: 2+ Skill Ranks in Medicine", "–Session Limit: 1", "–Time Cost: 2 Hours",
    "–Effect: Target a Character. They regain Life Points equal to 1/4 of their maximum. That Character "
      + "may also be treated as if they used the Rest Maneuver (this does not count towards the Rest "
      + "Maneuver’s Session Limit)."]);
  check("offered with 2+ Ranks in Medicine",
    adventuringManeuvers([care], [], { skills: { medicine: { ranks: 2 } } }).length, 1);
  const hurt = { life: { value: 10, max: 95 }, ki: { value: 5, max: 47 } };
  check("a quarter of their most Life; with the Rest, half their Life and Ki on top - down, never past",
    [caredFor(hurt, { lifeShare: 4 }), caredFor(hurt, { lifeShare: 4, restShare: 2 }),
     caredFor({ life: { value: 90, max: 95 }, ki: { value: 47, max: 47 } }, { lifeShare: 4, restShare: 2 })],
    [{ life: 33, ki: 5 }, { life: 80, ki: 28 }, { life: 95, ki: 47 }]);
  check("at the one token targeted; the Rest asked when done, and their Rest's use untouched",
    [care.targetsCharacter, care.alsoAs, CHAT.includes("async function careDone(patient) {"),
     CHAT.slice(CHAT.indexOf("async function careDone(patient) {"), CHAT.indexOf("async function fullRepairDone(")).includes("adventureUses")],
    [true, "rest", true, false]);
  check("in the index", INDEX_A.traits.includes("adventuring/care.dbu"), true);

  // --- Gauge
  const gauge = file("gauge");
  check("Gauge, as printed", printed(gauge), [
    "Gauge: Using your ability to sense energy, you size up a potential threat, learning their relative strength compared to your own.",
    "–Prerequisite: 2+ Skill Ranks in Clairvoyance", "–Session Limit: Infinite", "–Time Cost: 1 Minute",
    "–Effect: Target a Character you can sense. Make a Clash (Clairvoyance vs Concealment) against them. "
      + "If you win, you learn their Power Level and Alignment. You cannot target the same Character twice "
      + "with the Gauge Maneuver in an Adventuring Session."]);
  check("offered with 2+ Ranks in Clairvoyance, no Session Limit; Clairvoyance against Concealment",
    [adventuringManeuvers([gauge], [], { skills: { clairvoyance: { ranks: 2 } } })[0]?.limit,
     gauge.clashSkill, String(gauge.clashDefenderSkills)], [null, "clairvoyance", "concealment"]);
  check("the same Character twice in a Session refused, before anything is recorded",
    [gauge.oncePerTarget, SHEET.includes("aimed.filter(victim => uses.includes(`${entry.id}@${victim.uuid}`)) : [];"),
     SHEET.indexOf("if (again.length) {") < SHEET.indexOf("await this.actor.update({ \"system.adventureUses\": [...uses, ...aimed.map(")],
    [true, true, true]);
  check("won: Power Level and Alignment, the ARC's to tell - only that it landed said",
    [CHAT.includes("await settleReveals(message, clash);"),
     CHAT.includes("`${gauger.name} sizes up ${target.name} - what they learn, the ARC tells.`"),
     CHAT.includes("{ to: gauger }")], [true, true, false]);
  check("in the index", INDEX_A.traits.includes("adventuring/gauge.dbu"), true);

  // --- Tame
  const tame = file("tame");
  check("Tame, as printed", printed(tame), [
    "Tame: You subdue a wild animal, teaching it to follow your lead.",
    "–Prerequisite: 2+ Skill Ranks in Animal Handling", "–Session Limit: 1", "–Time Cost: 1 Day",
    "–Effect: Create a Minion. This Minion must be of the Animal Minion Race."]);
  check("offered with 2+ Ranks in Creature Handling - the entry's Animal Handling",
    [adventuringManeuvers([tame], [], { skills: { creatureHandling: { ranks: 2 } } }).length,
     adventuringManeuvers([tame], [], { skills: { creatureHandling: { ranks: 1 } } }).length], [1, 0]);
  check("the Minion said on the card", tame.effectNote, "creates a Minion of the Animal Minion Race");
  check("in the index", INDEX_A.traits.includes("adventuring/tame.dbu"), true);

  // --- Power Regulation
  const regulation = file("power-regulation");
  check("Power Regulation, as printed", printed(regulation), [
    "Power Regulation: You adjust your detectable strength, concealing or revealing it at-will.",
    "–Prerequisite: 2+ Skill Ranks in Concealment", "–Session Limit: Unlimited", "–Time Cost: N/A",
    "–Effect: You may freely gain or lose stacks of Holding Back. When entering a Combat Encounter, you "
      + "choose if you maintain or lose these stacks of Holding Back."]);
  check("offered with 2+ Ranks in Concealment; Unlimited is no Session Limit",
    [adventuringManeuvers([regulation], [], { skills: { concealment: { ranks: 2 } } })[0]?.limit, regulation.regulates],
    [null, "holding-back"]);
  check("the Holding Back window, the stacks set, no use recorded",
    [SHEET.includes("const chosen = await askHoldingBack(this.actor, { id: String(definition.regulates).trim(), name: definition.name });"),
     SHEET.includes("return setResource(this.actor, chosen.name, chosen.stacks);"),
     read("module", "use-maneuver.mjs").includes("export async function askHoldingBack(actor, maneuver) {")], [true, true, true]);
  const COMBAT_R = read("module", "combat.mjs");
  check("entering a Combat Encounter: read before the Resources clear, then Keep or Lose",
    [COMBAT_R.indexOf("const regulated = Number(actor.system.resources?.holdingback?.stacks) || 0;")
       < COMBAT_R.indexOf('"system.resources": replaceObject(keptResources(actor.system.resources))'),
     COMBAT_R.includes("await postRegulated(actor, regulated);"),
     CHAT.includes('if (keep && actor) await setResource(actor, "holdingback", regulated.stacks);')], [true, true, true]);
  check("in the index", INDEX_A.traits.includes("adventuring/power-regulation.dbu"), true);

  // --- Profiling
  const profiling = file("profiling");
  check("Profiling, as printed", printed(profiling), [
    "Profiling: You build a detailed personality profile about an individual, determining whether or not they are a potential threat.",
    "–Prerequisite: 2+ Skill Ranks in Intuition", "–Session Limit: Infinite", "–Time Cost: 1 Minute",
    "–Effect: Target a Character you can see. Make a Clash (Intuition vs Bluff/Intuition) against that "
      + "Character. If you win or lose, the ARC will supply you with information about that Character’s "
      + "personality and their intentions. If you win, this information will be true. If you lose, this "
      + "information will be false. You cannot target the same Character with the Profiling Maneuver more than "
      + "once during an Adventuring Session."]);
  check("offered with 2+ Ranks in Intuition, no Session Limit; Intuition against Bluff or Intuition, once a Character",
    [adventuringManeuvers([profiling], [], { skills: { intuition: { ranks: 2 } } })[0]?.limit, profiling.clashSkill,
     [].concat(profiling.clashDefenderSkills).join(",").split(",").map(s => s.trim()), profiling.oncePerTarget],
    [null, "intuition", ["bluff", "intuition"], true]);
  check("a plain Clash: nothing settled after it, nothing whispered (the user's ruling)",
    [profiling.clashUnaware, profiling.clashReveals, profiling.steals], [undefined, undefined, undefined]);
  check("in the index", INDEX_A.traits.includes("adventuring/profiling.dbu"), true);

  // --- Scavenge
  const scavenge = file("scavenge");
  check("Scavenge, as printed", printed(scavenge), [
    "Scavenge: You search for food in the wilds, coming back with wild vegetables and/or meat.",
    "–Prerequisite: 2+ Skill Ranks in Survival", "–Session Limit: 1", "–Time Cost: 2 Hours",
    "–Effect: You go out into the wilderness searching for food. Make a Survival Skill Check, with the "
      + "Difficulty Category decided by your ARC (taking into consideration where you begin to Scavenge and "
      + "what is available there). If you succeed, you will gain Ingredients. The amount- and if there’s any "
      + "Special Ingredients- will vary based on how much you exceed the Difficulty Category. The amount of "
      + "Ingredients shouldn’t exceed the number of players in the campaign."]);
  check("offered with 2+ Ranks in Survival; the Check and the Ingredients said once the time is spent",
    [adventuringManeuvers([scavenge], [], { skills: { survival: { ranks: 2 } } }).length,
     typeof scavenge.effectNote, String(scavenge.effectNote).includes("Ingredients")], [1, "string", true]);
  check("in the index", INDEX_A.traits.includes("adventuring/scavenge.dbu"), true);

  // --- Scam
  const scam = file("scam");
  check("Scam, as printed", printed(scam), [
    "Scam: You trick someone into giving you their money.",
    "–Prerequisite: 2+ Skill Ranks in Bluff", "–Session Limit: 1", "–Time Cost: 2 Hours",
    "–Effect: Increase your Riches by 1 for 1 day."]);
  const riches = { ...parseTraitFile(read("traits", "conditions", "scam-riches.dbu"), "conditions/scam-riches.dbu") };
  check("offered with 2+ Ranks in Bluff; its mark, ended by hand, with Cancel buff while held",
    [adventuringManeuvers([scam], [], { skills: { bluff: { ranks: 2 } } }).length, scam.gains,
     riches.name, riches.endedByHand, String(riches.maxStacks),
     adventuringManeuvers([scam], [], { skills: { bluff: { ranks: 2 } }, conditions: { "scam-riches": 1 } })[0].buffed],
    [1, "scam-riches", "Riches +1 (Scam)", true, "1", true]);
  check("in the index",
    [INDEX_A.traits.includes("adventuring/scam.dbu"), INDEX_A.traits.includes("conditions/scam-riches.dbu")], [true, true]);

  // --- Fraud
  const fraud = file("fraud");
  const { areaFor } = await import(modUrl("adventure.mjs"));
  check("Fraud, as printed", printed(fraud), [
    "Fraud: You pull the wool over the eyes of the unsuspecting sheep of your local area, leading them to believe that whatever you say is obviously true.",
    "–Prerequisite: 2+ Skill Ranks in Bluff", "–Session Limit: 1", "–Time Cost: 4 Hours",
    "–Effect: Spread rumours and/or misinformation within an area of your choosing. Make a Skill Check "
      + "(Bluff) against a Difficulty Category set by your ARC. If you win, the common people (and any NPCs "
      + "decided by the ARC) within that area believe the rumours and/or misinformation you’ve supplied until "
      + "proven to be false.\n\nThe area affected by your Fraud varies based on your number of Skill Ranks in "
      + "Bluff:\n\nAt 2~3 Skill Ranks, at most you can affect a single city. At 4 Skill Ranks, you may be able "
      + "to mislead a full country. At 5 Skill Ranks, even an entire planet may believe your lies."]);
  check("the area by Ranks in Bluff: a city at 2 or 3, a country at 4, a planet at 5",
    [2, 3, 4, 5, 1].map(ranks => areaFor(fraud, ranks)),
    ["at most a single city", "at most a single city", "a full country", "an entire planet", ""]);
  check("the rumour asked, the area and the Check said on the card",
    [fraud.asksTopic, fraud.topicLabel, CHAT.includes("${area ? ` (${escape(area)})` : \"\"}"),
     String(fraud.effectNote).includes(",")], [true, "Rumour", true, false]);
  check("in the index", INDEX_A.traits.includes("adventuring/fraud.dbu"), true);

  // --- Frighten
  const frighten = file("frighten");
  check("Frighten, as printed", printed(frighten), [
    "Frighten: You scare someone into believing you’re a threat to them.",
    "–Prerequisite: 2+ Skill Ranks in Intimidation", "–Session Limit: Infinite", "–Time Cost: Instant",
    "–Effect: Target a Character you can see or speak to. Make a Clash (Intimidation vs "
      + "Intuition/Intimidation) against them. If you win, increase your Alarm Rating for that Character by 1 "
      + "for 1 Day. You cannot target the same Character twice with the Frighten Maneuver in an Adventuring "
      + "Session (or while they are still influenced by its effects)."]);
  check("offered with 2+ Ranks in Intimidation, no Session Limit; against Intuition or Intimidation, once a Character",
    [adventuringManeuvers([frighten], [], { skills: { intimidation: { ranks: 2 } } })[0]?.limit, frighten.clashSkill,
     [].concat(frighten.clashDefenderSkills).join(",").split(",").map(s => s.trim()), frighten.oncePerTarget],
    [null, "intimidation", ["intuition", "intimidation"], true]);
  check("won: the Alarm Rating said, with both names",
    [frighten.clashWinNote, CHAT.includes("await settleWinNote(message, clash);"),
     CHAT.includes('.replaceAll("{challenger}", clash.challengerName).replaceAll("{defender}", clash.defenderName)}.`);')],
    ["{challenger}'s Alarm Rating for {defender} is 1 higher for 1 Day", true, true]);
  check("in the index", INDEX_A.traits.includes("adventuring/frighten.dbu"), true);

  // --- Befriend
  const befriend = file("befriend");
  check("Befriend, as printed", printed(befriend), [
    "Befriend: You convince someone that you are on the same side as them.",
    "–Prerequisite: 2+ Skill Ranks in Persuasion", "–Session Limit: Infinite", "–Time Cost: Instant",
    "–Effect: Target a Character you can see or speak to. Make a Clash (Persuasion vs "
      + "Intuition/Persuasion) against them. If you win, increase your Affection Rating for that Character by 1 "
      + "for 1 Day. You cannot target the same Character twice with the Befriend Maneuver in an Adventuring "
      + "Session (or while they are still influenced by its effects)."]);
  check("offered with 2+ Ranks in Persuasion, no Session Limit; against Intuition or Persuasion, once a Character; won, the Affection Rating said",
    [adventuringManeuvers([befriend], [], { skills: { persuasion: { ranks: 2 } } })[0]?.limit, befriend.clashSkill,
     [].concat(befriend.clashDefenderSkills).join(",").split(",").map(s => s.trim()), befriend.oncePerTarget,
     befriend.clashWinNote],
    [null, "persuasion", ["intuition", "persuasion"], true, "{challenger}'s Affection Rating for {defender} is 1 higher for 1 Day"]);
  check("in the index", INDEX_A.traits.includes("adventuring/befriend.dbu"), true);

  // --- Mingle
  const mingle = file("mingle");
  check("Mingle, as printed", printed(mingle), [
    "Mingle: You socialize with the locals, learning from them and improving their opinions of you.",
    "–Prerequisite: 2+ Skill Ranks in Persuasion", "–Session Limit: 1", "–Time Cost: 2 Hours",
    "–Effect: You enter a settlement and spend your time getting to know the people there. You gain any "
      + "information Characters there may have relevant to your situation and may increase your Affection "
      + "Rating with the Individuals or Factions at that settlement if you use the Mingle Maneuver enough times."]);
  check("offered with 2+ Ranks in Persuasion; what it gives said once the time is spent",
    [adventuringManeuvers([mingle], [], { skills: { persuasion: { ranks: 2 } } })[0]?.limit, typeof mingle.effectNote,
     String(mingle.effectNote).includes(",")], [1, "string", false]);
  check("in the index", INDEX_A.traits.includes("adventuring/mingle.dbu"), true);

  // --- Recruit
  const recruit = file("recruit");
  check("Recruit, as printed", printed(recruit), [
    "Recruit: You convince someone to join your ranks, following you on your adventures.",
    "–Prerequisite: 2+ Skill Ranks in Persuasion", "–Session Limit: 1", "–Time Cost: 1 Day",
    "–Effect: Create a Minion. That Minion’s Race is decided by the ARC."]);
  check("offered with 2+ Ranks in Persuasion; the Minion said on the card",
    [adventuringManeuvers([recruit], [], { skills: { persuasion: { ranks: 2 } } }).length, recruit.effectNote],
    [1, "creates a Minion - its Race decided by the ARC"]);
  check("in the index", INDEX_A.traits.includes("adventuring/recruit.dbu"), true);

  // --- Hunger
  const hunger = { ...parseTraitFile(read("traits", "conditions", "hunger.dbu"), "conditions/hunger.dbu") };
  const { HUNGER_STAGES } = await import(modUrl("adventure.mjs"));
  check("Hunger: three stages, not a Combat Condition, in the index",
    [String(hunger.maxStacks), hunger.combatCondition, INDEX_A.traits.includes("conditions/hunger.dbu")],
    ["3", false, true]);
  check("the stages, and none",
    HUNGER_STAGES.map(entry => [entry.stage, entry.label]), [[0, "Fed"], [1, "Hungry"], [2, "Ravenous"], [3, "Starving"]]);
  check("picked on the Adventure tab, set straight to the stage",
    [TAB.includes('data-action="setHunger"'), SHEET.includes('return setCondition(this.actor, "hunger", Math.max(0, Math.min(3, Number(target.dataset.stage) || 0)));')],
    [true, true]);

  // --- Ingredients
  const ingredients = { ...parseTraitFile(read("traits", "gear", "basic", "ingredients.dbu"), "gear/basic/ingredients.dbu") };
  check("Ingredients: a Basic Item, its count the charges, asked when given; not crafted",
    [ingredients.chargesLabel, ingredients.chargesAsked, ingredients.special, ingredients.craftDC ?? "",
     INDEX_A.traits.includes("gear/basic/ingredients.dbu")], ["Ingredients", true, true, "", true]);
  check("the count asked on adding, and set as the charges",
    [SHEET.includes("if (definition.chargesAsked === true) {"), SHEET.includes("data.system.charges = count;")], [true, true]);
  check("the entry, as given",
    printed(ingredients)[0].startsWith("Ingredients: Ingredients are an Adventure Resource (see — Adventure) that is used to cook"),
    true);

  // --- Cook
  const cook = file("cook");
  const { COOK_DIFFICULTIES, mealCost, ingredientsTaken, hungerAfter } = await import(modUrl("adventure.mjs"));
  check("Cook, as printed: its stat lines",
    printed(cook).slice(0, 4), [
      "Cook Maneuver: You use your skill in the kitchen to whip up some delicious grub.",
      "–Prerequisite: 2+ Skill Ranks in Cooking",
      "–Session Limit: Unlimited (but you only apply the effects from the last Meal you consumed upon entering a Combat Encounter)",
      "–Time Cost: 1 Hour"]);
  const { printedLines: printedAs } = await import(modUrl("effects/traits.mjs"));
  check("and its Difficulties, as printed - bullets the sheet shows one to a line",
    printedAs(cook.text).filter(line => line.startsWith("*")), [
      "* No Special Ingredient. The Difficulty Category is Apprentice.",
      "* Uncommon Ingredient. The Difficulty Category is Qualified.",
      "* Rare Ingredient. The Difficulty Category is Expert.",
      "* Legendary Ingredient. The Difficulty Category is Master."]);
  check("offered with 2+ Ranks in Cooking, no Session Limit",
    [adventuringManeuvers([cook], [], { skills: { cooking: { ranks: 2 } } })[0]?.limit, cook.cooks], [null, true]);
  check("the Difficulty by the highest Rarity",
    COOK_DIFFICULTIES.map(entry => entry.key), ["apprentice", "qualified", "expert", "master"]);
  check("the book's example: four Ravenous fed fully is 8; to Hungry is 4; unfairly, 5",
    [mealCost([2, 2, 2, 2].map(stages => ({ stages }))), mealCost([1, 1, 1, 1].map(stages => ({ stages }))),
     mealCost([1, 1, 1, 2].map(stages => ({ stages })))], [8, 4, 5]);
  const pools = [{ id: "plain", charges: 3 }, { id: "rare", charges: 2 }];
  check("paid from the first on; or as chosen, when it comes to the cost; never more than carried",
    [ingredientsTaken(pools, 4), ingredientsTaken(pools, 4, { plain: 2, rare: 2 }),
     ingredientsTaken(pools, 4, { plain: 1, rare: 2 }), ingredientsTaken(pools, 6)],
    [[{ id: "plain", count: 3 }, { id: "rare", count: 1 }], [{ id: "plain", count: 2 }, { id: "rare", count: 2 }], null, null]);
  check("made: each Hunger down by its share, never below Fed",
    [hungerAfter(2, 1), hungerAfter(2, 2), hungerAfter(1, 3)], [1, 0, 0]);
  check("paid before the card, an Item spent to nothing gone; the card's two outcomes",
    [SHEET.includes("if (left > 0) await item.update({ \"system.charges\": left });\n      else await item.delete();"),
     SHEET.indexOf("else await item.delete();") < SHEET.indexOf("return postCook(this.actor, definition,"),
     CHAT.includes("await setCondition(diner, \"hunger\", now);"),
     CHAT.includes('if (!made) await say("The Meal is ruined.");')
       && CHAT.includes('await cardRoll(message, { actorUuid: actor.uuid, type: "skill", key: "cooking", against: difficulty,')
       && CHAT.includes("get cook() { return [COOK_FLAG, unsettleCook, settleCook]; },")], [true, true, true, true]);
  check("in the index", INDEX_A.traits.includes("adventuring/cook.dbu"), true);

  // --- Scrap, and Auto-Succeed
  const scrap = { ...parseTraitFile(read("traits", "gear", "basic", "scrap.dbu"), "gear/basic/scrap.dbu") };
  check("Scrap: a Basic Item, its count the charges, asked when given; not crafted",
    [scrap.chargesLabel, scrap.chargesAsked, scrap.special, scrap.craftDC ?? "", INDEX_A.traits.includes("gear/basic/scrap.dbu")],
    ["Scrap", true, true, "", true]);
  const { craftAutoSucceeds } = await import(modUrl("adventure.mjs"));
  check("Auto-Succeed: 4 Ranks, Qualified or less; 5 Ranks, Expert or less; 3 Ranks, never",
    [craftAutoSucceeds(4, "qualified"), craftAutoSucceeds(4, "expert"), craftAutoSucceeds(5, "expert"),
     craftAutoSucceeds(5, "master"), craftAutoSucceeds(3, "novice"), craftAutoSucceeds(4, "")],
    [true, false, true, false, false, false]);
  check("a Craft Check from the sheet at such a Difficulty: no roll, a card that says so",
    [SHEET.includes('if (String(target.dataset.skill).startsWith("craft")) {'), SHEET.includes("if (craftAutoSucceeds(skill.ranks, ready.difficulty)) {"),
     SHEET.indexOf("if (craftAutoSucceeds(skill.ranks, ready.difficulty)) {") < SHEET.indexOf("skillRoll: true,\n      criticalTarget: skillCriticalTarget(this.actor, target.dataset.skill),\n      difficulty: ready.difficulty,")],
    [true, true, true]);

  // --- Create
  const create = file("create");
  const { createSkillFor, scrapCost, canCreateWith } = await import(modUrl("adventure.mjs"));
  check("Create, as printed: its stat lines and Time Costs",
    [printed(create).slice(0, 4), printedAs(create.text).filter(line => line.startsWith("*"))],
    [["Create: You craft an item from base components, creating something with function and purpose.",
      "–Prerequisite: 2+ Skill Ranks in the Craft Skill (or Medicine/Cooking for their relevant Basic Items)",
      "–Session Limit: 1", "–Time Cost: Varies"],
     ["* Basic Item. 8 hours.", "* Weapon. 1 day.", "* Apparel. 1 day.", "* Vehicle/Battle Jacket. 5 days."]]);
  check("offered with 2+ Ranks in any of Craft, Medicine or Cooking",
    ["craft", "medicine", "cooking", "bluff"].map(skill =>
      adventuringManeuvers([create], [], { skills: { [skill]: { ranks: 2 } } }).length), [1, 1, 1, 0]);
  check("[Med] rolls Medicine, [Food] Cooking, the rest Craft (Basic Item)",
    [createSkillFor(["med"]), createSkillFor(["food"]), createSkillFor(["tech"]), createSkillFor([])],
    [{ skill: "medicine", specialty: "" }, { skill: "cooking", specialty: "" }, { skill: "craft", specialty: "" },
     { skill: "craft", specialty: "" }]);
  check("Scrap 1 to 6, Novice to Grandmaster; a Battle Jacket double",
    [scrapCost("novice"), scrapCost("qualified"), scrapCost("grandmaster"), scrapCost("expert", { battleJacket: true })],
    [1, 3, 6, 8]);
  check("each Craft its own Skill: 2+ Ranks in the one for it",
    [canCreateWith({ skills: { craftApparel: { ranks: 2 } } }, "craft"), canCreateWith({ skills: { craft: { ranks: 2 } } }, "craft"),
     canCreateWith({ skills: { craftWeapons: { ranks: 2 } } }, "craftWeapons"), canCreateWith({ skills: { medicine: { ranks: 2 } } }, "medicine")],
    [false, true, true, true]);
  check("Create offered with 2+ in any Craft, Medicine or Cooking",
    ["craft", "craftApparel", "craftWeapons", "craftVehicles"].map(skill =>
      adventuringManeuvers([create], [], { skills: { [skill]: { ranks: 2 } } }).length), [1, 1, 1, 1]);
  check("Scrap paid once - the retry's card carries none; a [Food] Ingredient every attempt",
    [CHAT.includes("return postCreate(maker, { ...create, scrap: 0 });"),
     CHAT.includes("if (create.food && !(await maker.sheet?.payIngredientFor?.(create.name))) return;")], [true, true]);
  check("made: a Basic Item given as the Gear tab gives one, its maker's Ingenuity, no Gear Kit asked",
    [CHAT.includes("await maker.sheet?.giveGear?.(definition, { made: true, craftDC: create.difficulty });"),
     SHEET.includes("if ((data.system.records === \"ingenuity\") && !made) {"),
     SHEET.includes("return this.giveGear(definition);")], [true, true, true]);
  check("the retry is the same Create - no use counted on it",
    CHAT.slice(CHAT.indexOf("async function settleCreate("), CHAT.indexOf("function renderCurePoison(")).includes("adventureUses"),
    false);
  check("in the index", INDEX_A.traits.includes("adventuring/create.dbu"), true);

  // --- Blueprints
  const blueprint = { ...parseTraitFile(read("traits", "gear", "basic", "blueprint.dbu"), "gear/basic/blueprint.dbu") };
  const { hasBlueprint } = await import(modUrl("adventure.mjs"));
  check("the Blueprint: a Basic Item, gained through Create, its entry as given",
    [blueprint.special, blueprint.craftDC ?? "", INDEX_A.traits.includes("gear/basic/blueprint.dbu"),
     printed(blueprint)[0].startsWith("Blueprint: Once you have created anything through the Create Maneuver")],
    [true, "", true, true]);
  const held = [{ system: { blueprint: { kind: "basic", id: "bomb", name: "Bomb" } } },
    { system: { blueprint: { kind: "weapon", id: "", name: "Katana" } } }];
  check("one of each thing: a Basic Item by its file, the rest by name",
    [hasBlueprint(held, { kind: "basic", id: "bomb" }), hasBlueprint(held, { kind: "basic", id: "net" }),
     hasBlueprint(held, { kind: "weapon", name: "katana " }), hasBlueprint(held, { kind: "apparel", name: "Katana" })],
    [true, false, true, false]);
  check("made: a Blueprint given, not from a Blueprint; the record kept by the schema",
    [CHAT.includes("if (!create.blueprint && !create.noBlueprint) done.blueprint = await giveBlueprint(maker, create);"),
     read("module", "data", "item-gear.mjs").includes("blueprint: new fields.SchemaField({")], [true, true]);
  check("Create's card rolls its own Check - within Craft's Auto-Succeed, none - and settles by it, re-judged by a Critical or Karmic",
    [CHAT.includes('minus: create.diceMinus, minusLabel: "One Category harder", settles: { kind: "create", messageId: message.id } });'),
     CHAT.includes("&& craftAutoSucceeds(actor.system.skills?.[create.skill]?.ranks, create.difficulty);"),
     CHAT.includes('? ["Create item", "", createMade]'),
     CHAT.includes('? ["Try again", `Another ${create.time}${create.food ? " and another Ingredient" : ""}`, createAgain]'),
     CHAT.includes("get create() { return [CREATE_FLAG, unsettleCreate, settleCreate]; },"),
     !/export async function postCreate[\s\S]*?\n\}/.exec(CHAT)?.[0].includes("Roll it from the sheet")], [true, true, true, true, true, true]);
  check("from a Blueprint: in Create's list, costs paid as ever, no Check - made as the card is posted",
    [SHEET.includes('<optgroup label="Blueprints - no Check">'), SHEET.includes("blueprint: Boolean(plan), noBlueprint: Boolean(quick)"),
     CHAT.includes("  if (create.blueprint || auto) {\n    await settleCreate(message, message.getFlag(SCOPE, CREATE_FLAG), true);"),
     SHEET.indexOf("const plan = chosen.what.startsWith(\"bp:\")") < SHEET.indexOf("const scrapTaken = scrap ? ingredientsTaken(")],
    [true, true, true, true]);

  // --- Reputation
  const { AFFECTION_RATINGS, ALARM_RATINGS, reputationTN, reputationRows } = await import(modUrl("adventure.mjs"));
  check("Affection and Alarm, 0~4, as named",
    [AFFECTION_RATINGS.map(r => r.label), ALARM_RATINGS.map(r => r.label)],
    [["Hated", "Disliked", "Neutral", "Liked", "Loved"], ["Harmless", "Unbothered", "Neutral", "Feared", "Terrified"]]);
  check("the TN: lower by how far above 2, higher by how far below",
    [0, 1, 2, 3, 4].map(reputationTN), [2, 1, 0, -1, -2]);
  const rows = reputationRows([
    { id: "b", kind: "individual", name: "Loner", faction: "", affection: 2, alarm: 2 },
    { id: "r", kind: "faction", name: "Red Ribbon Army", faction: "", affection: 0, alarm: 3 },
    { id: "s", kind: "individual", name: "General Blue", faction: "r", affection: 1, alarm: 4 }]);
  check("each Faction with its Individuals under it, then those of none",
    rows.map(row => [row.name, row.member]), [["Red Ribbon Army", false], ["General Blue", true], ["Loner", false]]);
  check("each row: its names, and the Persuasion and Intimidation TN",
    [rows[0].affectionLabel, rows[0].alarmLabel, rows[0].persuasionTN, rows[0].intimidationTN, rows[0].kindLabel,
     rows[1].intimidationTN],
    ["Hated", "Feared", "+2", "-1", "Faction", "-2"]);
  check("Create Faction, Add Individual, the steps, rename and remove - a Faction's Individuals kept, of none",
    [TAB.includes('data-action="addReputation" data-kind="faction">Create Faction'),
     TAB.includes('data-action="addReputation" data-kind="individual">Add Individual'),
     SHEET.includes("[which]: Math.max(0, Math.min(4, (Number(entry[which]) || 0) + step))"),
     SHEET.includes('.map(each => (each.faction === entry.id) ? { ...each, faction: "" } : each) });')],
    [true, true, true, true]);

  // --- Training Bonuses
  check("Gain Training Bonus: a published one's mark set, or the ARC's own written down; End takes it and its mark",
    [TAB.includes('data-action="gainTrainingBonus"'), SHEET.includes("if (trait) await setCondition(this.actor, trait.id, 1);"),
     SHEET.includes("if (bonus.key) await setCondition(this.actor, bonus.key, 0);"),
     SHEET.includes(".filter(bonus => !bonus.key || ((Number(this.actor.system.conditions?.[bonus.key]) || 0) > 0))")],
    [true, true, true, true]);
  check("a Maneuver's limit raised by an effect - the Surge's",
    read("module", "maneuvers.mjs").includes("const more = Math.max(0, applySlot(actor.system.effects?.slots, `${maneuver.id}.uses`, 0));"),
    true);

  // --- Wealth
  const { STATUSES, richesNow, statusFor, wealthTN } = await import(modUrl("adventure.mjs"));
  check("the Statuses by Riches: 0, 1~2, 3~5, 6~8, 9~10",
    [0, 1, 2, 3, 5, 6, 8, 9, 10].map(riches => statusFor(riches).label),
    ["Destitute", "Broke", "Broke", "Comfortable", "Comfortable", "Rich", "Rich", "Filthy Rich", "Filthy Rich"]);
  check("Scam's day: 1 more while its mark is held, never past 10",
    [richesNow({ riches: 4 }), richesNow({ riches: 4, conditions: { "scam-riches": 1 } }).total,
     richesNow({ riches: 10, conditions: { "scam-riches": 1 } }).total], [{ own: 4, scammed: 0, total: 4 }, 5, 10]);
  check("the rule of thumb: 4 + the lowest Status's least Riches",
    STATUSES.map(status => wealthTN(status.label)), [4, 5, 7, 10, 13]);
  check("the Wealth Check: a d10 and the Riches that count",
    [SHEET.includes("const roll = await new Roll(`1d10 + ${riches.total}`).evaluate();"), TAB.includes('data-action="wealthCheck"'),
     TAB.includes('data-action="stepRiches" data-step="1"')], [true, true, true]);

  check("New Session a button of its own beside Travel, once",
    [(TAB.match(/data-action="newAdventureSession"/g) ?? []).length,
     TAB.indexOf('data-action="newAdventureSession"') < TAB.indexOf('data-section="adventure-maneuvers"')], [1, true]);
  check("the tab folds by subject, each closed until opened: Adventuring Maneuvers, Cooking, and the rest",
    [TAB.includes('data-section="adventure-maneuvers"'), TAB.includes('data-section="adventure-cooking"'),
     TAB.includes('data-section="adventure-{{subject.key}}"'),
     SHEET.includes('context.adventureSubjects = [["reputation", "Reputation"], ["training", "Training"],'),
     TAB.indexOf('data-action="setHunger"') > TAB.indexOf('data-section="adventure-cooking"')],
    [true, true, true, true, true]);
  check("the name uses it; the arrow and the rest of the row open its entry as printed; no Use button, no hover",
    [TAB.includes('<div class="maneuver-head" data-action="toggleManeuver">'), TAB.includes('data-item-id="adv-{{maneuver.id}}"'),
     TAB.includes('class="maneuver-name rollable" data-action="useAdventuring"') && !TAB.includes(">Use</button>"),
     TAB.includes('data-tooltip="{{maneuver.text}}"'), SHEET.includes("open: Boolean(this.#openSections[`maneuver-adv-${entry.id}`]) }));")],
    [true, true, true, false, true]);
  check("listed on the Adventure tab, with New Session",
    [TAB.includes('data-action="useAdventuring"'), TAB.includes('data-action="newAdventureSession"')], [true, true]);
}

console.log(`\n${failed} failing`);
process.exit(failed ? 1 : 0);
