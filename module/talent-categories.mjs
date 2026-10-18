/**
 * Talent Categories: which group each Talent belongs to.
 *
 * "At Character Creation you gain 4 free Talents of your choice, each from a different Talent Category." The Categories
 * and every Talent's name in each, in the order dbu-rpg.com/talents lists them (the user's, 2026-10-15) - so a Talent's
 * Category is known by its name even before its file is written, and a Talent Item written by hand is placed by its name
 * too. A Talent file may still say its own with `talentCategory:`, which wins.
 *
 * Racial Talents are grouped again by race; theirs is `racial`, with the race beside it.
 */

/** The Categories, in the order the page lists them. */
export const TALENT_CATEGORIES = Object.freeze([
  { id: "attacking", label: "Attacking" },
  { id: "balance", label: "Balance" },
  { id: "buddy", label: "Buddy" },
  { id: "condition", label: "Condition" },
  { id: "counter", label: "Counter" },
  { id: "damaging", label: "Damaging" },
  { id: "dodging", label: "Dodging" },
  { id: "durability", label: "Durability" },
  { id: "energy-attack", label: "Energy Attack" },
  { id: "grappling", label: "Grappling" },
  { id: "initiative", label: "Initiative" },
  { id: "insightful", label: "Insightful" },
  { id: "magic-attack", label: "Magic Attack" },
  { id: "mindful", label: "Mindful" },
  { id: "minion", label: "Minion" },
  { id: "mobility", label: "Mobility" },
  { id: "multi-type", label: "Multi-Type" },
  { id: "physical-attack", label: "Physical Attack" },
  { id: "racial", label: "Racial" },
  { id: "raging", label: "Raging" },
  { id: "size", label: "Size" },
  { id: "skill", label: "Skill" },
  { id: "specialization", label: "Specialization" },
  { id: "starter", label: "Starter" },
  { id: "super-stack", label: "Super Stack" },
  { id: "surge", label: "Surge" },
  { id: "taunt", label: "Taunt" },
  { id: "teamwork", label: "Teamwork" },
  { id: "technique", label: "Technique" },
  { id: "threshold", label: "Threshold" },
  { id: "transformation", label: "Transformation" },
  { id: "weapon", label: "Weapon" },
  { id: "miscellaneous", label: "Miscellaneous" }
].map(Object.freeze));

/** Every Talent's name, by Category, in the page's order. */
const ROSTER = {
  "attacking": ["Artful Strike", "Focused Strike", "Masterful Strike"],
  "balance": ["Balanced Warrior", "Balanced Defender", "Balanced Mind", "Balanced in Yin and Yang", "Jack of All Styles",
    "Lord of Balance", "Power of the Z-Warrior"],
  "buddy": ["Buddy Collector", "Buddy to Buddies", "Buddy System"],
  "condition": ["Combat Tactician", "Perfected Tactics", "Beat-down Tactics"],
  "counter": ["Wild Counter", "Fierce Counter", "Perfect Counter", "Jolt Counter", "Full Counter", "Exploit Expert",
    "Master of Openings", "Shock Tornado"],
  "damaging": ["Bruising Wound", "Injuring Wound", "Critical Wound"],
  "dodging": ["Cunning Dodge", "Instinctual Dodge", "Masterful Dodge", "Free Flowing Stance", "Agile Warrior"],
  "durability": ["Effective Defenses", "Resilience", "Tough Warrior", "Risky Bet", "Superior Durability"],
  "energy-attack": ["Enhanced Shot", "Point Blank Shot", "Artillery Shot", "Blaster Master"],
  "grappling": ["Brawler", "Wrestler", "Judo Training", "Heel", "Suplex", "Human Shield", "Personal Space"],
  "initiative": ["Improved Initiative", "Alert", "Attentive Warrior", "Speedblitz", "Lightning Initiative", "Patient Fighter"],
  "insightful": ["Insightful Warrior", "Combat Wisdom", "Tai Chi Practitioner", "Tai Chi Expert", "Tai Chi Master"],
  "magic-attack": ["Magic Blaster", "Magic Caster", "Elementalist", "Magic Master", "Magic Warrior"],
  "mindful": ["Calm Mind", "Combat Zen", "Zen Counter", "Tranquil Warrior"],
  "minion": ["Master of Minions", "Minion Coordinator", "Minion Mark", "Sacrificial Minion", "Minion Army", "Minion Supporter"],
  "mobility": ["Footwork", "Power of Movement", "Fleet of Foot", "High Speed Ace"],
  "multi-type": ["Multi-Type Attacker", "Multi-Type Specialist", "Multi-Type Gambit", "Multi-Type Master"],
  "physical-attack": ["Enhanced Fist", "Iron Fist", "Rapid Fist", "Supreme Fist"],
  "raging": ["Angry Warrior", "Burning Fury", "Furious Berserker", "Apoplectic Beast"],
  "size": ["Tremendous Warrior", "Size Matters", "Miniature Warrior", "Size Doesn’t Matter"],
  "skill": ["Practiced", "Show Stopping Performance", "Dynamic Hype", "Team Pose", "Analytic Fighter", "Flexible Planning",
    "Counter Jury-rigging", "Silent Footsteps", "Stealth Strike", "Assassinate", "Master Assassin", "Acrobat Star", "Expert Pilot",
    "Yoink", "Battlefield Doctor", "Enhanced Search", "Terrifying Presence", "Terrifying Speed", "Desperate Distraction",
    "Last Ditch Effort", "Survivalist", "Team Survivalist", "Feint Master", "Trickster Magician", "Frequent Flyer", "Instant Craft"],
  "specialization": ["Archetype Focus", "Archetype Defense", "Precision Kata", "Brutal Kata", "Profile Focus"],
  "starter": ["Slow Starter", "Warm Up", "Reserved Combatant", "Conserving Strength", "Jump Start", "All-Out Start"],
  "super-stack": ["Muscular Warrior", "Hefty Muscle", "Herculean Power", "Steel Muscle", "Adamantine Muscle", "Compact Muscle",
    "Flexible Muscle"],
  "surge": ["Second Wind", "Never Surrender", "Lion's Heart", "Lightning Surge"],
  "taunt": ["Mental Warfare", "Taunt", "Improved Taunt"],
  "teamwork": ["Flexible Flanker", "Supporting Defender", "Opportunist", "Power Gifter", "Teamwork", "Synchronized Combatants",
    "Superior Synchronization", "Chosen Rival", "Eternal Rival", "Desperate Support"],
  "technique": ["Bag of Tricks", "Energy Control", "Technique Master", "Favored Technique", "Flexible Technique",
    "Powerful Technique", "Unique Technique", "Terrifying Technique", "Quick Learner", "Perfect Mimicry", "Copy Index",
    "Advanced Learner", "Technique Armory"],
  "threshold": ["Vigor", "High Risk Battler", "Battle at the Edge", "Diehard", "Fortitude", "Steadfast Warrior",
    "Undying Determination", "Pain Resistant", "Steady Momentum"],
  "transformation": ["Bursting Transformation", "Desperate Transformation", "Enhanced Transformation", "Forceful Transformation",
    "Under Pressure", "Specialized Transformation", "Inspiring Transformation", "Overwhelming Transformation", "Self Control"],
  "weapon": ["Weapon Specialist", "Category Specialist", "Dueling Specialist", "Light Weapons Specialist",
    "Heavy Weapons Specialist", "Iaijutsu Specialist", "Dual Wielding Specialist", "Twin Weapon Specialist", "Critical Specialist",
    "Variety Specialist", "Weapon Fixer", "Weapon Master", "Variable Fighter", "Variable Champion"],
  "miscellaneous": ["Concentrated Energy", "Experienced Drunk", "Ferocious Fighter", "Furious Flex", "Lucky", "Naturist",
    "Au Naturel", "Superhuman Physique", "God-like Physique", "Snack Fiend", "Swaggering Wager", "Willpower", "Practiced Charger",
    "Arrogance"]
};

/** The Racial Talents, by race - the page's groups, in its order, with the race's id. */
export const RACIAL_TALENT_GROUPS = Object.freeze([
  { race: "android", label: "Androids", talents: ["Unflinching Resilience", "Android Fusion", "Honorbound", "3D Scan Mode",
    "Masterful Integration", "Metallic Movement"] },
  { race: "angel", label: "Angels", talents: ["Angelic Technique", "Angelic Guidance", "Watchful Gaze", "Attendant's Focus"] },
  { race: "arcosian", label: "Arcosians", talents: ["Reserved Tail"] },
  { race: "bio-android", label: "Bio-Androids", talents: ["Genetic Catalogue"] },
  { race: "cerealian", label: "Cerealians", talents: ["Mystical Gaze", "Dedicated Spotter"] },
  { race: "demon", label: "Demons", talents: ["Hedge Your Bets", "Honorable Demon", "Versatile Demon"] },
  { race: "earthling", label: "Earthlings", talents: ["Iron Guard", "Mystic Power", "Way of the Champion", "Zooming Third Eye"] },
  { race: "glass-tribe", label: "Glass Tribe", talents: ["Autonomous Glass Soldiers", "Copy in the Mirror", "Glass Decorations"] },
  { race: "heran", label: "Herans", talents: ["Marauding Captain", "Sorcering Corsair", "Style and Greed"] },
  { race: "konatsian", label: "Konatsians", talents: ["Party Tactics", "Weapon Arts"] },
  { race: "majin", label: "Majins", talents: ["Goop Throw", "Battle Goo", "Detached Limbs", "Mini Majin", "AIIIEEEEEEE",
    "Roomy Biology"] },
  { race: "namekian", label: "Namekians", talents: ["Namekian Progenitor", "Telepathic Teamwork", "Namekian Finger"] },
  { race: "neko-majin", label: "Neko Majins", talents: ["Cat's Paw", "Feline Rally", "Will of Nine Lives", "Cat Burglar"] },
  { race: "neo-tuffle", label: "Neo-Tuffles", talents: ["Tuffle Fusion", "Mutualism", "Tuffle Parasite", "Scholar's Intellect"] },
  { race: "saiyan", label: "Saiyans", talents: ["Saiyan Tail Resistance", "Tail Proficiency", "Kindhearted Saiyan", "Primal Rage",
    "Saiyan Soul"] },
  { race: "shinjin", label: "Shinjin", talents: ["Combat Observation", "Dedicated Watcher"] },
  { race: "yardrat", label: "Yardrats", talents: ["Spiritual Leadership", "Twinned Spirits", "Yaki Swarm", "Yaki Master"] }
].map(Object.freeze));

/** A name as it is compared: case, curly apostrophes and spacing aside. */
function key(name) {
  return String(name ?? "").toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim();
}

/** Name -> where it sits: its Category, its place in it, and a Racial Talent's race. */
const PLACES = new Map();
for (const [category, names] of Object.entries(ROSTER)) {
  names.forEach((name, index) => PLACES.set(key(name), { category, index }));
}
{
  let index = 0;
  for (const group of RACIAL_TALENT_GROUPS) {
    for (const name of group.talents) PLACES.set(key(name), { category: "racial", index: index++, race: group.race });
  }
}

const ORDER = new Map(TALENT_CATEGORIES.map((category, index) => [category.id, index]));

/** Every Talent's name in a Category, in the page's order - a Racial Talent's, every race's. */
export function talentsInCategory(id) {
  if (id === "racial") return RACIAL_TALENT_GROUPS.flatMap(group => group.talents);
  return [...(ROSTER[id] ?? [])];
}

/** A Category by its id - or null. */
export function talentCategory(id) {
  return TALENT_CATEGORIES.find(category => category.id === id) ?? null;
}

/**
 * Where a Talent belongs: an Item's own `category` (or a file's `talentCategory`) where it says one, its name's place in the
 * roster otherwise. `{ id, label, race, raceLabel, order, index }`, or null for a name the roster does not know and nothing
 * names.
 */
export function talentCategoryOf(talent) {
  const named = talent?.system?.category || talent?.talentCategory || "";
  const place = PLACES.get(key(talent?.name)) ?? null;
  const id = (named && ORDER.has(named)) ? named : place?.category;
  if (!id) return null;
  const race = (id === "racial") ? (talent?.system?.race || talent?.race || place?.race || "") : "";
  return {
    id,
    label: talentCategory(id)?.label ?? id,
    race,
    raceLabel: race ? (RACIAL_TALENT_GROUPS.find(group => group.race === race)?.label ?? race) : "",
    order: ORDER.get(id) ?? TALENT_CATEGORIES.length,
    index: (place?.category === id) ? place.index : Number.MAX_SAFE_INTEGER
  };
}

/** Talents in the page's order: by Category, then where each sits in it, then by name. */
export function compareTalents(a, b) {
  const one = talentCategoryOf(a), two = talentCategoryOf(b);
  const at = cat => cat ? cat.order : TALENT_CATEGORIES.length;
  return (at(one) - at(two)) || ((one?.index ?? Infinity) - (two?.index ?? Infinity))
    || String(a?.name ?? "").localeCompare(String(b?.name ?? ""));
}
