import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const ROOT = process.argv[2];
const require = createRequire(`${(process.env.FOUNDRY_APP || (process.env.FOUNDRY_APP || String.raw`C:\Program Files\Foundry Virtual Tabletop\resources\app`))}/package.json`);
const Handlebars = require("handlebars");
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), "utf8");

let failed = 0;
const check = (label, ok) => { if (!ok) failed++; console.log(`${ok ? "ok  " : "FAIL"}  ${label}`); };

const gear = Handlebars.compile(read("templates", "parts", "actor-gear.hbs"));
const row = { itemId: "w1", name: "Sword", img: "x.svg", typeLabel: "Standard Physical Slashing · Grade 3",
  weapon: true, wielded: true, wieldBlocked: "", wieldCost: "No Effort Maneuver", breakLabel: "Life Points 20/40",
  repairable: false, flexes: [{ value: "piercing", label: "Piercing" }], flexedTo: "", resizes: [{ value: "big", label: "Big" }],
  remote: true, connectedName: "every Bomb", attunes: false, canTrigger: true, snacks: 2, sheathedName: "" };
const html = gear({ tabs: { gear: { cssClass: "active" } }, openSections: { gearWeapons: true },
  gear: { basic: [], apparel: [], weapon: [row, { ...row, itemId: "w2", name: "Broken", wielded: false,
    wieldBlocked: "Broken: repair it first.", breakLabel: "Broken", repairable: true, flexes: [], resizes: [],
    remote: false, snacks: 0, sheathedName: "Scabbard" }] } });
check("the Weapons list renders its rows", html.includes('data-item-id="w1"') && html.includes('data-item-id="w2"'));
check("Wield / Sheathe, blocked with its reason",
  html.includes(">Sheathe</button>") && html.includes('disabled data-tooltip="Broken: repair it first.">Wield</button>'));
check("Flexible, Variable, Trigger, Snack, Repair, in its Sheath",
  ['data-action="flexGear"', 'data-value="piercing"', 'data-action="resizeGear"', 'data-action="remoteGear"',
   'data-action="snackGear"', 'data-action="repairGear"', "in Scabbard", "&rarr; every Bomb"].every(bit => html.includes(bit)));
check("Add Weapon", html.includes('data-action="addWeapon"'));

const buddies = gear({ tabs: { gear: { cssClass: "active" } }, openSections: { gearBuddies: true },
  gear: { basic: [], apparel: [], weapon: [], buddy: [
    { itemId: "b1", name: "Pal", img: "x.svg", buddy: true, active: true, buddyKind: "Greater", choiceLabel: "Ride Buddy · Flyin'",
      tip: "helps", callBlocked: "", actions: [{ key: "ride", form: false, label: "Ride", used: false, tip: "A Standard Maneuver" }],
      remote: true, canTrigger: true, grows: true },
    { itemId: "b2", name: "Gone", img: "x.svg", buddy: true, destroyed: true, actions: [] },
    { itemId: "b3", name: "Waiting", img: "x.svg", buddy: true, callBlocked: "Pal is Active: dismiss it first.", actions: [] }] } });
check("the Buddies list: Dismiss for the Active one, its actions, Trigger, Grow Senzu",
  ['data-action="callBuddy" data-item-id="b1"', ">Dismiss</button>", 'data-action="useBuddy"', 'data-key="ride"',
   'data-form="false"', 'data-action="remoteGear" data-item-id="b1"', 'data-action="growSenzu"', "[Greater]",
   "Ride Buddy · Flyin&#x27;", 'data-action="addGear" data-list="buddy"'].every(bit => buddies.includes(bit)));
check("a destroyed one says so and cannot be called; another waits for the Active one",
  [buddies.includes("Destroyed"), !buddies.includes('data-action="callBuddy" data-item-id="b2"'),
   buddies.includes('disabled data-tooltip="Pal is Active: dismiss it first.">Call</button>')].every(Boolean));

const crafted = Handlebars.compile(read("templates", "parts", "gear-crafted.hbs"));
const page = crafted({ tabs: { crafted: { cssClass: "active" } }, entry: [],
  crafted: { weapon: true, gradeChoices: [{ value: 1, label: "1 - Apprentice, 0 Slots", chosen: true }],
    typeChoices: [{ value: "physical", label: "Physical", chosen: true }],
    weaponSizeChoices: [{ value: "small", label: "Small", tip: "Strike +1(T)" }],
    categoryChoices: [{ value: "slashing", label: "Slashing", chosen: true }],
    reading: { used: 1, slots: 2, lifeLeft: 40, lifeMax: 40, damageReduction: 6, hardnessRank: 2 } } });
check("the Weapon tab: Grade, Type, Size, Category, and what it is",
  ['name="system.crafted.weaponType"', 'name="system.crafted.weaponSize"', "Life Points: 40/40",
   "Damage Reduction: 6", "Hardness Rank: 2"].every(bit => page.includes(bit)));
const apparel = crafted({ tabs: { crafted: {} }, entry: [], crafted: { weapon: false, categoryChoices: [],
  gradeChoices: [], sizeChoices: [], bonusLabel: "1(bT)", reading: { gradeLabel: "Low", used: 0, slots: 0,
    breakLeft: 3, breakValue: 3 } } });
check("and an Apparel's as it was", apparel.includes("Apparel Bonus: 1(bT)") && !apparel.includes("weaponType"));

console.log(`${failed} failing`);
process.exit(failed ? 1 : 0);
