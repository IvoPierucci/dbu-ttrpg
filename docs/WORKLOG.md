# Work log and open items

This is the shared notebook between contributors and their assistants. **Read it before you start, and update it before
you stop.** Keep "Open items" current. In the log, add a dated line under your name for anything another person would
need to know: a half-finished feature, a decision taken, something you found broken and didn't fix.

## State of the system (2026-11-26)

- Version **0.3.14** in `system.json`. Everything up to it is pushed; later commits may not be (see `git log origin/main..`).
- **Built:**
  - Characters, Minions, Adversaries, Fusions and Vehicles (Actor types), with the full character sheet.
  - Every race and Racial Trait, Factors, Other Traits (Evolution, Bestial, Monstrous, Vocations), all Talent Categories,
    Maneuvers, Unique Abilities, Signature Techniques with Super Profiles, Gear (Apparel, Weapons, Items, Buddies),
    Battlefields and Weather, Karma, Custom Buffs, Adventure.
  - Transformations: 76, all from the owners' links or texts.
- **Testing:** most of it has been checked headlessly but little of it in a real Foundry game. Treat any bug report from
  the table as real.

## Open items

### Waiting on a rules text from the owners
Don't read these from the site yourself; ask an owner for the text or link.
- **Minion Traits:** 15 names known (Specialized Minion, Sentry, Steed, Summonable Minion, Master and Friends, Disposable,
  Emotional Support, Self-Destructive, Servant, Autonomous, Supportive, Medical, Taunting, Designated Driver, Minion
  Assassin). Their texts are missing, and they are to be picked from the Other Traits list like Vocations.
- **Battle Jackets:** not built. Expert Pilot (3)(5), the Vehicles' Jacket Dock and Way of the Pilot's TP wait on them.
- **Transformation Talents** (the Transformation Category's 9 Talents): not built yet; Transformations now exist.
- **Desperate Hero / Desperate Battle:** needed by You Can't Destroy What I Am! (2)-(4) (Full Power Super Saiyan) and
  Greater Super Class (2).
- **Transformations named by Full Power Super Saiyan's Styles:** Future, Xeno and Ancestral Super Saiyan, All-Out Form.
  Superior Super Saiyan exists.
- **Others:** Teleport (Adventuring Maneuver), Consumed Lifeforce, Unify's full text, Tamagami, a few cut descriptions
  (Battle Yardrat's "Y", All-Out Super Saiyan's "T", 13 Bio-Android Genetic Focus descriptions).

### Left to the table on purpose
Each file says so in its comments, with the word "the table's". To list them all:
`grep -rn "the table's" traits/`. Most are map placement (which Squares, where a token goes) or things the group
narrates.

### Adversary Transformations: tried and not tried (2026-11-28, the second contributor's Claude)
What was checked, so whoever touches these knows what to trust and what to try first at a table.
- **Headless battery** (`bash tests/check.sh`): every file compiles; the 7 Maneuvers in the Special lists; 76 Transformations;
  `tests/adversary.mjs` pins every piece of the machinery (see its "second pass" block).
- **Quench in Foundry v14** (a local test module, not in this repository; 114 tests, all passing), on real actors: each Awakening's
  Attribute bonuses, Soak, Wound, Surgency and Narrative Stamina worked out by hand from the texts; the Maneuvers each opens; Raid
  Boss's doubled Category Life; Overflowing Power's numbers and its Surge in a Combat; the verbs `spendAdversaryActions`,
  `gainStamina`/`spendStamina`/`multiplyStamina`, `knockedJustBelow`, `lifeBelowNextThreshold`, `inflictedLosesKi`,
  `conditionOnLeave`, `shedForAdversaryActions`; the resource headers; the Slots of Speedster (3), Teamwork (3)(5), Dramatic (2),
  Bruiser (4), Trickster (4).
- **Played by hand in Foundry** (real attack cards and windows):
  - Meteor Striker (2): on the hero's turn card, an Adversary Action spent and Basic Attack / Signature Technique offered.
  - Raid Boss (3): "A Standard AoE of your choice?" asked as the attack was declared, and added.
  - Pain Addict's Numb: 23 Damage taken as 11, then 28 as 13 with the Deal Damage window showing 13 (stacks put on by hand - the
    (4) Threshold trigger itself not played).
  - Unbreaking Tide: 33 Armor Points (1/4 of 133) on entering; a 24-Damage hit took 5 Armor Points to 0, left the Transformation,
    2 Broken. Dangerous Counter (3) ticked after the hit paid an Adversary Action.
- **Not played yet** (built, checked headlessly or in Quench only) - the first things to try at a table:
  - Weak Slayer's double Damage against a real Minion; Villainous Boast.
  - Archetypal Trickster (4)'s box in a Save or Skill Clash, (5) on a real Condition; Twisted Trick.
  - Terrifying Teamwork (5)'s offer when an Ally of the team deals Damage; Kill Box; (6)/(7).
  - Corruption's Massive Blow and Desolated's end of turn on a Square that has it.
  - Archetypal Bruiser (6)/(7) (an AoE added, Bruiser Charges), Speedster (4)-(7), Stable Foe (5)-(7) and Directional Defense,
    Sadistic Villain, Tireless, Dramatic Antagonist (4)-(6) and Sinful Soliloquy, Adversary Burst, Meteor Striker (1)(3).
  - Any of them against a real player's client (everything was tried as the GM on one client).
- **Seen while testing, not changed:** Dangerous Counter (3)'s Basic Attack asks for a targeted token (the verb does not take the
  attacker from the hit) - on a scene with tokens it is a click; without one it says so.

### Known gaps
- **`README.md` screenshots and install manifest:** not set up.
- **Adversary Transformations, still the table's** (each says so in its file):
  - Archetypal Trickster (6): moving an Opponent's Natural Result after their Combat Roll - the window after a roll is the roller's own
    (their Karmic Effects), and an Opponent's choice has no place in it yet.
  - Unbreaking Tide (3)'s Broken when the Transformation is unticked on the sheet by hand (Revert, a failed Stress Test and (2) give it).
  - Sinful Soliloquy's and Meteor Striker's descriptions read "Y" on the site (copied as they are).
  - Map placement: which Squares an AoE, Kill Box, Directional Defense or Desolated covers, and moving tokens.

## Log

Newest first. Keep it to one or two lines per item; the commit message has the detail.

- **2026-11-28 (Ivo's Claude):**
  - A race's own Traits are asked in one window, a page a Trait (`module/race-window.mjs` askPages, `racial.mjs` traitPage), then made
    with the answers (`racialItemFrom(..., {answers})`, `addRacialTrait(..., {made, grants})`). Picked ones (Majins, Minions), Factor
    Traits and Add Racial Trait keep their own windows. Closed early: every Trait given, unanswered parts empty; the Progression tab's
    "Set Racial Options" (next to Racial Grants) asks only those (`unansweredOf`, `answerRaceTraitQuestions`).
  - What a Trait gives by choice (`grantSpecsOf`: Other Traits, a Unique Ability, a Talent, a Factor Trait, a Dragon Ball, Installed
    Weapons) has its own pages, and the pencil a row each (`grantRowsOf` / `changeGrant`; a given Other Trait keeps its row, `grantSlot`).
  - Enhanced Organism: `exchangesRaceTrait` / `exchangeFactor` - Functional Purpose exchanged for an Alternate Upbringing Trait, asked;
    kept until said (`owedExchange`). `chooseExceptRacial: true` for "an additional Saving Throw". `skillRanked` offers None.
  - Greater Mutation (3) / Mastered Reincarnated (1) built: `allow restoreReplaced.<factor>;`. Syncs of one character run one at a time
    (no duplicate Traits). Settings' Debug holds Refresh Racial Traits and Refresh Talents.
- **2026-11-28 (the second contributor's Claude):** the Adversary Transformations' gaps closed, all generic:
  - `costs N counter` paid in every window: offerTriggers (dodged-attack, hit-not-knocked...), answerDeclare, Respond (applyResponses,
    after the Counter played) and the hit (applyHitChoice) - payTickedCounterCosts.
  - Resource headers `resourceHalvesDamage` (Numb: a stack, the Damage halved - halveByResource), `resourceDrainedByDamage` +
    `resourceEmptyLeaves: <transformation>` (Armor Points lowered by the Life Points an attack takes, at 0 the Transformation left -
    drainOnDamage). Our reading: Super Armor lowers both Life and Armor Points ("by the same amount", not "instead").
  - Verbs `conditionOnLeave(<transformation>, <condition>, <stacks>, <duration>)` (leftTransformation), `lifeBelowNextThreshold(<threshold>)`
    (Desolated's end of turn), `shedForAdversaryActions(<except...>)`, `inflictedLosesKi(highest|<attribute>)`.
  - Moment `inflict-condition` (chat.mjs conditionGained: any Combat Condition on an Opponent, `inflictedUuid`).
  - Slots `chargingAssault.capPerTier` (signature.mjs), `combatRecovery.halfSurgency` (combat-recovery.dbu), `united.teamworkMultiplier`
    (united-attack.mjs), `clash.adversaryBump` (a box in a Save or Skill Clash, Fairy's way), `allyDamage.basicAttack` (an offer on the
    attack's card); `ignoresQualities:` read on Transformation Traits too (registry.mjs qualitiesSuffered - Corruption (3)).
  - Bruiser (4)'s Gigantic Grip is `wrestler.grip` (the same words as Wrestler (1)). Unbreaking Tide (3)'s "for 1 Combat Round" read as
    till the start of your next turn (our reading).
  - Rulings from the owner in docs/RULINGS.md ("Adversary Transformations"). Tried in Foundry (Quench, 114/114): the new verbs, headers
    and Slots on real actors. By hand, a Basic Attack each: against Pain Addict with 2 Numb, 23 Damage taken as 11 (a stack left); against
    Unbreaking Tide with 5 Armor Points, 24 Damage - the Armor Points to 0, the Transformation left, 2 Broken; Dangerous Counter (3) ticked
    on hit-not-knocked spent an Adversary Action. Not tried by hand: the Clash box, the ally's offer.
  - The Deal Damage window shows the Damage as Numb leaves it (halvingResourceOf): "28 - 2 Soak - 0 DR / 2 Numb = 13", the Narrative
    Stamina and Thresholds read off 13 - tried in Foundry, 13 taken.
- **2026-11-27 (the second contributor's Claude):**
  - Overflowing Power and the 15 other Adversary Transformations from the owner's links (6 Lesser, 7 Greater Awakenings; Unbreaking
    Tide, Adversary Burst, Meteor Striker) with 7 Maneuvers of their own (Special, `source: Core Rule` - not Villainous, which every
    Adversary would get) and the Desolated Environmental Quality.
  - Machinery, all generic: `adversaryActionCost` on any Maneuver (use-maneuver.mjs adversaryCostRefused / payActions); verbs
    `spendAdversaryActions(all|any, <resource>)`, `gainStamina`, `spendStamina`, `multiplyStamina`, `knockedJustBelow`; Slots
    `narrativeStamina.multiplier`, `area.anyAdded` (+`Round`, `AdversaryCost`), `area.destructiveAdded` (maneuvers.mjs
    askAnyAddedArea), `damage.vsMinions.multiplier`, `speed.byForce`, `adversaryLife.multiplier`; predicates `opponentInMelee`,
    `opponentWithin(<magnitude>)`, `allOpponentsLowerTier`, `targetsAllLowerTier`, `targetBelowThreshold(<threshold>)`; Moment
    `opponent-start-of-turn` (offered on that turn's own card: announceTurn adds the answerers to its subjects); `areaClash` with
    `fullMight`, `impulsiveVsCorporeal`, or no outcome (a move, the table's).
  - Moment cards: Apply effects on another's turn card fires `opponent-start-of-turn` (its `opponentUuid` the turn-taker), and pays `costs N counter` (payCounterCosts) - tried in Foundry: Meteor Striker (2) spent an Adversary Action and offered Basic Attack / Signature Technique.
  - Readings of our own, confirmed by the owner 2026-11-28 (docs/RULINGS.md) - Stable Foe (6) since then asks how many.
- **2026-11-27 (Ivo's Claude):**
  - The race gives its Racial Traits: `module/race-traits.mjs` (raceTraitPlan, syncRaceTraits, exchangeChoices/exchangeRaceTrait,
    resetRaceTraits), `system.racialPicks`, `system.debug.showAddRacialTrait`, `races/majin.json secondaryChoices: 4`, a one-time
    reset (world setting `raceTraitsReset`), harness `tests/race-traits.mjs`. An exchanged Factor Trait keeps `flags.dbu-ttrpg.exchangedFor`.
  - Added Greater Mutation (its (3) built 2026-11-28, see above).
  - Added Saiyan Prodigy: `resourceOverflowOf` / `resourceOverflowWhen` (traits.mjs resourceDefinitions, moments-runtime.mjs gainOneOf) and the `overflow.<name>` flag Slots.
  - Added Super Majin. Its (4) (what may be changed as it is gained) is the table's, done by hand on the sheet.
  - Added Unkillable Majin and Grand Awakenings: `slot: grand` + `grandTrigger: N` on the Trait, the verb `grandTrigger()` (the
    Awakening's `flags.dbu-ttrpg.grandMet` = this Combat's id), the predicate `grandTriggerMet`, the Full Awakening Maneuver
    (`traits/maneuvers/full-awakening.dbu`, verb `fullAwakening()`, `grandOn`), the `full-awakening` Moment.
  - Minions and Fusions with Transformations (the owner's links to /minions/ and /fusion/): Duplicates copy Transformation Items
    (`minion-make.mjs isDuplicatedItem`); `MINION_AWAKENING_LIMIT`; a Fusion's Awakening left out by `flags.dbu-ttrpg.fusionOff`
    (`transformations.mjs fusionLeftOut`, read by `inUse` and `awakeningCount`). A non-Duplicate Minion's Enhancements and Forms
    are the ARC's to give by hand, as the page says.
  - `module/content-ready.mjs`: the actor sheets' `render` waits on the content loaded in `setup` (`waitForContent`).
  - A Maneuver added to the system reaches old characters by itself: a GM `ready` hook gives missing core Maneuver Items once
    (`flags.dbu-ttrpg.coreGranted`). A `ready` hook that reads content files must `await contentLoaded` (setup is async).
  - Trait text on the sheet: `racialTraitLines(item, live)` - with `live` (the sheet's `#liveOf`) the site's style, uses left,
    Automatic, and real values in brackets (`realValues`, hidden by `system.hideRealValues`). Without `live`, as printed: what
    reads its HTML for "(N)-" (the [Constant] lines, harnesses) relies on that.
  - Trait rows' buttons: Foundry gives every button `min-height: var(--button-size)`; a small button needs `min-height: 0` beside
    its `height` (`.trait-arm`, `.trait-control`). The owner's choices for the Trait text are in `docs/RULINGS.md`.
- **2026-11-26 (Ivo's Claude):**
  - Added Super Kaioken: headers `initial:` (a Special Enhancement's Initial Enhancement) and `onlyAlongside:`.
  - Respond: the Direct Hit box shows the Category lowered by ticked Direct Hit effects (`categorySteps`, `damageWith`).
  - Amount windows take a `note` (`askPlayerAmount(..., { note })`): `adaptationNote(held)`, `mostNote("4(bT)", full, most)`.
  - The verification battery moved into the repository (`tests/`); run `bash tests/check.sh`.
  - Added `CLAUDE.md`, `docs/`, `CHANGELOG.md` and `tools/reindex.py`, and updated `README.md`.
  - Added Steel Frame and Boiling Rage (with `sharesUses:`).
  - Fixed Ascended Signature through Quick to Master / Earthling-Raised (the Ascend choice and Karmic Assault now show).
  - Signature Technique uses are now recorded under the Technique's own id.
- **2026-11-21/22 (Ivo's Claude):**
  - Transformation cards: Apply effects for every Triggered/Transform effect, and out-of-sequence buttons with
    `offerOneOf`.
  - Added Giant's Vantage and Unsealed Instinct, Time-Skipper and Superior Super Saiyan.
