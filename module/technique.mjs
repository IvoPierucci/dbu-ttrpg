/**
 * Signature Techniques as they are built: their level, their Profile, their Advantages and
 * Disadvantages, and what all of that comes to in Technique Points and Ki Points.
 *
 * "To create a Signature Technique ... Choose a level ... Choose a Foundation and Profile ...
 * Select Advantages and Disadvantages ... Calculate the total Ki Point Cost and total
 * Technique Point Cost."
 *
 * A Technique is still a Maneuver Item tagged `signature`; what it was built out of lives in
 * its `system.signature`. The features themselves are files in traits/signature/, named by
 * the Techniques that bought them. This module knows the arithmetic and the Requirements;
 * what each feature does at the table is read where the attack is rolled.
 */

import { getSignatureFeature, getTrait, traitsOfKind } from "./effects/traits.mjs";
import { PROFILES, SUPER_PROFILES, areaMagnitude, magnitudeIndex, MAGNITUDES } from "./maneuvers.mjs";

/** "Super, Ultimate or Dramatic Finisher." A Dramatic Finisher is an Ultimate. */
export const LEVELS = Object.freeze({
  super: { label: "Super", ultimate: false },
  ultimate: { label: "Ultimate", ultimate: true },
  dramatic: { label: "Dramatic Finisher", ultimate: true }
});

/** "Each Signature Technique starts with a Technique Point (TP) Cost of 8." */
export const BASE_TP = 8;

/** "Ultimate Signature Techniques increase the TP Cost ... by 4 ... after all modifications." */
export const ULTIMATE_TP = 4;

/** "The overall TP Cost of a Signature Technique cannot be less than 8." */
export const MINIMUM_TP = 8;

/** The most TP one Technique may be worth, by base Tier of Power: 25, 30, 40, 50 from 4 on. */
export function tierTpCap(baseTier) {
  const tier = Math.max(1, Number(baseTier) || 1);
  return [25, 30, 40][tier - 1] ?? 50;
}

/** "You can only use up to 3 Ultimate Signature Techniques during the entire Combat Encounter." */
export const ULTIMATES_PER_ENCOUNTER = 3;

/** Whether a level is an Ultimate one - a Dramatic Finisher is. */
export function isUltimate(level) {
  return Boolean(LEVELS[level]?.ultimate);
}

/** A Technique's build, with every list present, whatever the Item had stored. */
export function signatureOf(item) {
  const sig = item?.system?.signature ?? {};
  return {
    level: LEVELS[sig.level] ? sig.level : "super",
    foundation: sig.foundation ?? "",
    profile: sig.profile ?? "",
    secondProfile: sig.secondProfile ?? "",
    superProfile: sig.superProfile ?? "",
    fromTransformation: Boolean(sig.fromTransformation),
    features: Array.from(sig.features ?? []).map(entry => ({
      id: entry.id, ranks: Math.max(1, Number(entry.ranks) || 1), choice: entry.choice ?? ""
    })).filter(entry => entry.id)
  };
}

/** Whether an Item is a Technique built through the builder rather than a bare tagged one. */
export function isBuilt(item) {
  return Boolean(item?.system?.signature?.profile);
}

/** A feature's definition, whichever side it is on. */
export function featureDef(id) {
  return getSignatureFeature(id);
}

/** Every feature there is, as a list per side, in name order. */
export function featureCatalogue() {
  return {
    advantages: traitsOfKind("signature", "advantages"),
    disadvantages: traitsOfKind("signature", "disadvantages")
  };
}

/** A list header read as numbers: "4, 6, 8" or a single 4. */
function numbers(value) {
  if (Array.isArray(value)) return value.map(Number).filter(Number.isFinite);
  if ((value === undefined) || (value === null) || (value === "")) return [];
  return String(value).split(",").map(part => Number(part.trim())).filter(Number.isFinite);
}

/** The most ranks a feature may be taken to: as many prices as it lists, or one. */
export function maxRanks(def) {
  if (!def) return 1;
  const stated = Number(def.ranks) || 0;
  return Math.max(1, stated || numbers(def.tpCostPerRank).length || 1);
}

/**
 * What a feature's ranks cost together. "To buy another rank of an Advantage, you must pay
 * the TP Cost listed" - so each rank pays its own price and they add up: Power Shot at three
 * ranks is 4 + 6 + 8. A Disadvantage's are negative and add up the same way.
 */
export function featureTP(def, ranks = 1) {
  if (!def) return 0;
  const prices = numbers(def.tpCostPerRank);
  const count = Math.max(1, Math.min(maxRanks(def), Number(ranks) || 1));
  if (!prices.length) return (Number(def.tpCost) || 0) * count;
  let total = 0;
  for (let rank = 0; rank < count; rank++) total += prices[Math.min(rank, prices.length - 1)];
  return total;
}

/**
 * The Technique's TP Cost: 8, plus its Advantages, less its Disadvantages, never under 8 -
 * and then +4 for an Ultimate, "applied after all modifications".
 */
export function techniqueTP(sig) {
  const features = (sig.features ?? []).reduce((sum, entry) =>
    sum + featureTP(featureDef(entry.id), entry.ranks), 0);
  const built = Math.max(MINIMUM_TP, BASE_TP + features);
  return built + (isUltimate(sig.level) ? ULTIMATE_TP : 0);
}

/** How many ranks of one feature a build carries. */
export function ranksOf(sig, id) {
  return (sig.features ?? []).find(entry => entry.id === id)?.ranks ?? 0;
}

/** The choice stored with one feature, or "". */
export function choiceOf(sig, id) {
  return (sig.features ?? []).find(entry => entry.id === id)?.choice ?? "";
}

/**
 * A Super Profile's own price per Tier. Multi-Profile's "varies depending on the Ki Point
 * Cost of the selected Profile": 1(T) up to 4(T), 2(T) from 5(T) to 7(T), 3(T) from 8(T).
 */
export function superProfileKiPerTier(superId, secondProfile = "") {
  const entry = SUPER_PROFILES[superId];
  if (!entry) return 0;
  if (entry.multiProfile) {
    const listed = PROFILES[secondProfile]?.kiCostPerTier ?? 0;
    return (listed <= 4) ? 1 : (listed <= 7) ? 2 : 3;
  }
  return Number(entry.kiCostPerTier) || 0;
}

/**
 * What the Technique adds to its Profile's Ki Point Cost, per Tier of Power.
 *
 * "Increase the KP Cost of a Signature Technique by x(T), where x is equal to 1/5 of that
 * Signature Technique's Technique Point Cost (rounded up)." Efficiency takes 4(T) a rank off
 * and Inefficiency puts 4(T) a rank on, and "the overall KP Cost ... cannot be less than that
 * of the Profile" - so this part is never below nothing. A Super Profile's own cost is added
 * on top, and it is part of that floor: "this also is factored in for the Minimum".
 *
 * Back Flip's 1(T) is not here: it is a discount on each use, and the user ruled it may go
 * under the Profile.
 */
export function techniqueKiPerTier(sig) {
  const x = Math.ceil(techniqueTP(sig) / 5);
  const own = Math.max(0, x - (4 * ranksOf(sig, "efficiency")) + (4 * ranksOf(sig, "inefficiency")));
  return own + (sig.superProfile ? superProfileKiPerTier(sig.superProfile, sig.secondProfile) : 0);
}

/** The Profile's own listed price per Tier, for the sheet. */
export function profileKiPerTier(profileId) {
  return Number(PROFILES[profileId]?.kiCostPerTier) || 0;
}

/** The ids a build carries, one entry per rank - what `system.advantages` has always held. */
export function expandedFeatures(sig) {
  const list = [];
  for (const entry of sig.features ?? []) {
    for (let rank = 0; rank < entry.ranks; rank++) list.push(entry.id);
  }
  return list;
}

/** The Profiles an attack made with this build is "of": its own, and Multi-Profile's second. */
export function profilesOf(sig) {
  return [sig.profile, (sig.superProfile === "multi-profile") ? sig.secondProfile : ""].filter(Boolean);
}

// --- The area an attack is made with -------------------------------------------------------

/**
 * The Area of Effect this attack ends up with, and what built it.
 *
 * The order, as ruled: the Profiles' Areas (the player picks when two have one) -> Widespread
 * Assault adds one -> Super Beam adds a Line -> Hurricane Assault resets to Standard -> Small
 * Scale Blast sets Minor -> the centre (Self-Explosion, Distant Explosion) -> Magnitude steps
 * (Terrain Destruction, the Weapon, Super Beam's one per two Charges) -> held to Destructive ->
 * the Concentrated Profile's cap -> Limited Line's length -> Cataclysmic's whole Battlefield.
 *
 * `picked` is which Profile's Area stands when two Profiles each have one.
 *
 * @returns {{ area: ?object, notes: string[] }}
 */
export function buildArea({ profiles = [], features = [], choices = {}, weaponArea = null,
                            weaponSteps = 0, charges = 0, superProfile = "", picked = "" } = {}) {
  const notes = [];
  const has = id => features.includes(id);
  const ranks = id => features.filter(entry => entry === id).length;

  const withArea = profiles.filter(id => PROFILES[id]?.area);
  const fromProfile = withArea.includes(picked) ? picked : withArea[0];
  let area = fromProfile ? { ...PROFILES[fromProfile].area } : (weaponArea ? { ...weaponArea } : null);

  if (!area && has("widespread-assault")) {
    const shape = ["sphere", "line", "cone"].includes(choices["widespread-assault"])
      ? choices["widespread-assault"] : "sphere";
    area = { shape, magnitude: "standard", ...(shape === "sphere" ? { anySquare: true } : {}) };
    notes.push("Widespread Assault");
  }
  if (!area && (superProfile === "super-beam")) {
    area = { shape: "line", magnitude: "standard" };
    notes.push("Super Beam");
  }
  if (!area) return { area: null, notes };

  if (has("hurricane-assault") && profiles.includes("sweeping")) {
    area.magnitude = "standard";
    notes.push("Hurricane Assault");
  }
  if (has("small-scale-blast") && (area.shape === "sphere")) {
    area.magnitude = "minor";
    notes.push("Small Scale Blast");
  }
  if (area.shape === "sphere") {
    if (has("self-explosion")) {
      delete area.centredOnTarget; delete area.anySquare;
      area.centredOnSelf = true;
    }
    else if (has("distant-explosion")) {
      delete area.centredOnSelf; delete area.anySquare;
      area.centredOnTarget = true;
    }
  }

  let steps = (Number(area.magnitudeSteps) || 0) + (Number(weaponSteps) || 0);
  if (has("terrain-destruction")) steps += ranks("terrain-destruction");
  if ((superProfile === "super-beam") && (area.shape === "line")) steps += Math.floor((Number(charges) || 0) / 2);
  area.magnitudeSteps = steps;

  // Held to the ends of the ladder: nothing is larger than Destructive.
  const top = MAGNITUDES.length - 1;
  const base = Math.max(0, MAGNITUDES.indexOf(areaMagnitude(area)));
  if (base + steps > top) area.magnitudeSteps = top - base;

  // "The AoE for this Attacking Maneuver cannot have a Magnitude larger than Standard, nor can it
  // have an AoE applied to it other than the Line AoE."
  if (profiles.includes("concentrated")) {
    if (area.shape !== "line") {
      notes.push("Concentrated: only a Line AoE");
      area = { ...PROFILES.concentrated.area };
    }
    if (magnitudeIndex(area) > MAGNITUDES.indexOf("standard")) {
      area.magnitudeSteps = MAGNITUDES.indexOf("standard") - Math.max(0, MAGNITUDES.indexOf(areaMagnitude(area)));
      notes.push("Concentrated: no larger than Standard");
    }
  }

  if (has("limited-line") && (area.shape === "line")) {
    area.lengthSquares = (ranks("limited-line") >= 2) ? 4 : 8;
  }
  if (superProfile === "cataclysmic-attack") {
    area.wholeBattlefield = true;
    delete area.lengthSquares;
  }
  return { area, notes };
}

// --- Requirements -----------------------------------------------------------------------------

/**
 * Whether a Requirement (or a Super Profile's Prerequisite) holds.
 *
 * Written in a feature's `requires:` header as a small language: terms separated by commas all
 * have to hold; a term is alternatives separated by `|`, any one of which is enough; an
 * alternative is atoms joined by `+`, all of which have to hold. `!` in front of an atom denies
 * it. So Back Flip's "Hit and Run Advantage, Energy Attack, Magic Attack, Soaring Profile, or a
 * Physical Attack with the Charging Assault Advantage" is
 *
 *     has:hit-and-run, foundation:energy|foundation:magic|profile:soaring|foundation:physical+has:charging-assault
 *
 * Atoms:
 *   aoe, aoe:sphere|line|cone     the attack's final Area, and its shape
 *   profile-aoe                   an Area from its Profile(s) alone (Widespread's "does not
 *                                 possess an AoE", measured before it adds its own)
 *   magnitude<=standard           the final Area's Magnitude
 *   profile:<id>                  one of the attack's Profiles (Multi-Profile's second counts)
 *   elemental-weather             an Elemental Profile some Battle Weather is Connected to
 *   foundation:<id>               the attack's Foundation
 *   level:ultimate|super          an Ultimate (a Dramatic Finisher is one) or a Super
 *   has:<id>, ranks:<id>>=<n>     a feature on the Technique
 *   same-roll:<id>                a feature whose Strike/Wound choice matches this one's
 *   chose:<id>=<value>            a feature on the Technique with that choice
 *   skill:<id>>=<n>               the character's Skill Ranks
 *   choice-skill>=<n>             the Skill this feature chose, in the character's Ranks
 *   maneuver:<id>                 the character has the Maneuver
 *   alignment                     the character's Z-Soul is not Neutral
 *   threshold:<key>               at that Health Threshold or worse
 *   charges>=<n>                  Energy Charges on the attack
 *
 * An atom about the character with no character to ask, or about the attack with no attack
 * yet, holds: a Requirement that cannot be read is not a reason to refuse.
 */
export function requirementHolds(expression, ctx) {
  const terms = Array.isArray(expression) ? expression
    : String(expression ?? "").split(",").map(part => part.trim()).filter(Boolean);
  return terms.every(term => String(term).split("|")
    .some(alternative => alternative.split("+").every(atom => atomHolds(atom.trim(), ctx))));
}

const THRESHOLD_ORDER = ["healthy", "bruised", "injured", "critical"];

function atomHolds(raw, ctx) {
  if (!raw) return true;
  const negated = raw.startsWith("!");
  const atom = negated ? raw.slice(1) : raw;
  const value = evaluateAtom(atom, ctx);
  if (value === null) return true;
  return negated ? !value : value;
}

function evaluateAtom(atom, ctx) {
  const [name, arg = ""] = atom.split(":");
  const compare = String(atom).match(/^([\w-]+)(?::([\w-]+))?\s*(>=|<=)\s*(\w+)$/);
  const actor = ctx.actor ?? null;

  if (compare) {
    const [, key, id, op, amount] = compare;
    const test = n => ((op === ">=") ? n >= Number(amount) : n <= Number(amount));
    if (key === "ranks") return test(ctx.ranks?.(id) ?? 0);
    if (key === "charges") return (ctx.charges === undefined) ? null : test(ctx.charges);
    if (key === "skill") return actor ? test(skillRanks(actor, id)) : null;
    if (key === "choice-skill") return actor ? test(skillRanks(actor, ctx.choice)) : null;
    if (key === "magnitude") {
      if (!ctx.area) return false;
      const limit = MAGNITUDES.indexOf(amount);
      return (op === "<=") ? (magnitudeIndex(ctx.area) <= limit) : (magnitudeIndex(ctx.area) >= limit);
    }
    return null;
  }

  switch (name) {
    case "aoe": return arg ? (ctx.area?.shape === arg) : Boolean(ctx.area);
    case "profile-aoe": return (ctx.profiles ?? []).some(id => PROFILES[id]?.area);
    case "profile": return (ctx.profiles ?? []).includes(arg);
    case "elemental-weather": return (ctx.profiles ?? []).some(id => connectedWeather(id));
    case "foundation": return ctx.foundation ? (ctx.foundation === arg) : null;
    case "level": return (arg === "ultimate") ? Boolean(ctx.ultimate) : !ctx.ultimate;
    case "has": return (ctx.ranks?.(arg) ?? 0) > 0;
    case "same-roll": return ((ctx.ranks?.(arg) ?? 0) > 0) && (ctx.choiceOf?.(arg) === ctx.choice);
    case "chose": {
      // "Restricted – High Environment": the Restricted – Environment Disadvantage, with High.
      const [id, value] = arg.split("=");
      return ((ctx.ranks?.(id) ?? 0) > 0) && (ctx.choiceOf?.(id) === value);
    }
    case "maneuver": return actor ? hasManeuver(actor, arg) : null;
    case "alignment": return actor ? ((Number(actor.system?.alignment) || 0) !== 0) : null;
    case "threshold": {
      if (!actor) return null;
      const at = THRESHOLD_ORDER.indexOf(actor.system?.threshold?.key ?? "healthy");
      return at >= THRESHOLD_ORDER.indexOf(arg);
    }
    default: return null;
  }
}

/** A character's Skill Ranks in one Skill. */
function skillRanks(actor, skill) {
  const entry = actor?.system?.skills?.[skill];
  return Number(entry?.ranks ?? entry?.rank ?? entry?.value ?? 0) || 0;
}

/** Whether a character owns a Maneuver by its library id. */
function hasManeuver(actor, id) {
  return Array.from(actor?.items ?? []).some(item =>
    (item.type === "maneuver") && ((item.system?.maneuverId || item.id) === id));
}

/**
 * The Battle Weather an Elemental Profile is Connected to, read from the Weathers' own entries:
 * "Connected Profile: Elemental (Ice)" is written in Cold Weather's file.
 */
export function connectedWeather(profileId) {
  const label = PROFILES[profileId]?.label;
  if (!label) return null;
  return traitsOfKind("battlefields").find(trait => String(trait.text ?? "")
    .includes(`Connected Profile: ${label}`)) ?? null;
}

/**
 * What a Requirement or Prerequisite is read against: the build, and whatever is known of the
 * attack and of the character.
 */
export function requirementContext(sig, { actor = null, area, charges, ultimate, foundation } = {}) {
  const profiles = profilesOf(sig);
  const features = expandedFeatures(sig);
  return {
    actor,
    profiles,
    foundation: foundation ?? sig.foundation ?? "",
    ultimate: (ultimate !== undefined) ? ultimate : isUltimate(sig.level),
    area: (area !== undefined) ? area : buildArea({ profiles, features, choices: choicesOf(sig),
      superProfile: sig.superProfile }).area,
    charges,
    ranks: id => ranksOf(sig, id),
    choiceOf: id => choiceOf(sig, id)
  };
}

/** Every feature's stored choice, by feature id. */
export function choicesOf(sig) {
  return Object.fromEntries((sig.features ?? []).map(entry => [entry.id, entry.choice ?? ""]));
}

/**
 * Why a feature cannot be on this Technique, or "" when it can.
 *
 * The file's own words are the reason, since they are what the table will check it against.
 */
export function featureProblem(id, sig, options = {}) {
  const def = featureDef(id);
  if (!def) return "Unknown feature.";
  if (!def.requires) return "";
  const ctx = { ...requirementContext(sig, options), choice: choiceOf(sig, id) };
  return requirementHolds(def.requires, ctx) ? "" : `Requirement: ${def.requirement}`;
}

/** Why a Super Profile would not apply, or "". */
export function superProfileProblem(superId, sig, options = {}) {
  const entry = SUPER_PROFILES[superId];
  if (!entry) return "";
  if (!entry.prerequisite) return "";
  return requirementHolds(entry.prerequisite, requirementContext(sig, options))
    ? "" : `Prerequisite: ${entry.prerequisiteText}`;
}

// --- Effects ------------------------------------------------------------------------------------

/** A feature part's opening line: `#@ advantage power-shot | Power Shot (2 ranks)`. */
const PART_OPEN = /^#@\s+(advantage|disadvantage)\s+(\S+)\s*(?:\|\s*(.*?))?\s*$/;
const PART_CLOSE = /^#@\s+end\s*$/;

/** A Technique's Effects, as its features' parts and the text between them. */
export function techniqueEffectParts(script) {
  const out = [];
  let text = [];
  let open = null;
  const flush = () => {
    const joined = text.join("\n").replace(/^\s*\n/, "").replace(/\s+$/, "");
    if (joined) out.push({ text: joined });
    text = [];
  };
  for (const line of String(script ?? "").replace(/\r\n?/g, "\n").split("\n")) {
    const opens = line.trim().match(PART_OPEN);
    if (!open && opens) {
      flush();
      open = { type: opens[1], id: opens[2], name: opens[3] ?? "", lines: [] };
      continue;
    }
    if (open && PART_CLOSE.test(line.trim())) {
      out.push({ type: open.type, id: open.id, name: open.name,
        body: open.lines.join("\n").replace(/^\s*\n/, "").replace(/\s+$/, "") });
      open = null;
      continue;
    }
    (open ? open.lines : text).push(line);
  }
  if (open) out.push({ type: open.type, id: open.id, name: open.name, body: open.lines.join("\n").trim() });
  else flush();
  return out;
}

/** What a feature writes into the Technique's Effects: what it does, and its own code if any. */
function featureBody(def) {
  const code = String(def?.script ?? "").replace(/\r\n?/g, "\n").split("\n")
    .filter(line => !/^\s*(#|\/\/)/.test(line)).join("\n").trim();
  return [`# ${def?.summary ?? def?.name ?? ""} - built in`, code].filter(Boolean).join("\n");
}

/** A feature's name as its part names it: "Power Shot (2 ranks)". */
function featurePartName(def, entry) {
  const ranks = (maxRanks(def) > 1) ? ` (${entry.ranks} rank${(entry.ranks === 1) ? "" : "s"})` : "";
  const choice = entry.choice ? ` - ${choiceLabel(def, entry.choice)}` : "";
  return `${def?.name ?? entry.id}${ranks}${choice}`;
}

/**
 * Write a Technique's features into its Effects, as an Apparel's Qualities are written into its
 * own: a part per feature, the parts already there keep what is written in them, a removed
 * feature's part is taken out, a new one's is written from its file, and the text outside every
 * part is its owner's and stays. `previous` of "" rebuilds everything - Re-sync.
 */
export function composeTechniqueEffects(sig, previous = "") {
  const existing = techniqueEffectParts(previous);
  const had = new Map(existing.filter(part => part.id).map(part => [part.id, part]));
  const wanted = (sig.features ?? []).map(entry => ({ entry, def: featureDef(entry.id) }))
    .filter(({ def }) => def);
  const wantedIds = new Set(wanted.map(({ def }) => def.id));
  const partOf = ({ entry, def }) => ({
    type: (def.owner === "disadvantages") ? "disadvantage" : "advantage",
    id: def.id,
    name: featurePartName(def, entry),
    body: had.get(def.id)?.body ?? featureBody(def)
  });
  const out = [];
  for (const part of existing) {
    if (!part.id) out.push(part);
    else if (wantedIds.has(part.id)) out.push(partOf(wanted.find(({ def }) => def.id === part.id)));
  }
  for (const want of wanted) {
    if (had.has(want.def.id)) continue;
    let last = -1;
    out.forEach((each, index) => { if (each.id) last = index; });
    out.splice((last >= 0) ? last + 1 : out.length, 0, partOf(want));
  }
  return out.map(part => (part.id
    ? [`#@ ${part.type} ${part.id} | ${part.name}`, part.body, "#@ end"].filter(Boolean).join("\n")
    : part.text)).join("\n\n");
}

/** The trait a choice names, for a label: a Condition, a State, a Weather. */
export function choiceLabel(def, choice) {
  if (!choice) return "";
  const kind = def?.choose ?? "";
  if (kind === "profile") return PROFILES[choice]?.label ?? choice;
  if (["condition", "state", "weather", "environment"].includes(kind)) return getTrait(choice)?.name ?? choice;
  if (kind === "weapon") return choice;
  return choice.replace(/(^|[\s-])\w/g, c => c.toUpperCase()).replace(/-/g, " ");
}
