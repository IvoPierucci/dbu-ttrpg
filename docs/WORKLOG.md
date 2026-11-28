# Work log and open items

This is the shared notebook between contributors and their assistants. **Read it before you start, and update it before
you stop.** Keep "Open items" current. In the log, add a dated line under your name for anything another person would
need to know: a half-finished feature, a decision taken, something you found broken and didn't fix.

## State of the system (2026-11-26)

- Version **0.3.12** in `system.json`. Everything up to it is pushed; later commits may not be (see `git log origin/main..`).
- **Built:**
  - Characters, Minions, Adversaries, Fusions and Vehicles (Actor types), with the full character sheet.
  - Every race and Racial Trait, Factors, Other Traits (Evolution, Bestial, Monstrous, Vocations), all Talent Categories,
    Maneuvers, Unique Abilities, Signature Techniques with Super Profiles, Gear (Apparel, Weapons, Items, Buddies),
    Battlefields and Weather, Karma, Custom Buffs, Adventure.
  - Transformations: 60, all from the owners' links or texts.
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

### Known gaps
- **`README.md` screenshots and install manifest:** not set up.

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
