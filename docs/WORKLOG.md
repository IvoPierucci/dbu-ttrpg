# Work log and open items

This is the shared notebook between contributors and their assistants. **Read it before you start, and update it before
you stop.** Keep "Open items" current. In the log, add a dated line under your name for anything another person would
need to know: a half-finished feature, a decision taken, something you found broken and didn't fix.

## State of the system (2026-11-26)

- Version **0.3.8** in `system.json`. Everything up to it is pushed; later commits may not be (see `git log origin/main..`).
- **Built:**
  - Characters, Minions, Adversaries, Fusions and Vehicles (Actor types), with the full character sheet.
  - Every race and Racial Trait, Factors, Other Traits (Evolution, Bestial, Monstrous, Vocations), all Talent Categories,
    Maneuvers, Unique Abilities, Signature Techniques with Super Profiles, Gear (Apparel, Weapons, Items, Buddies),
    Battlefields and Weather, Karma, Custom Buffs, Adventure.
  - Transformations: 56, all from the owners' links or texts.
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

- **2026-11-27 (Ivo's Claude):**
  - Trait text on the sheet: `racialTraitLines(item, live)` - with `live` (the sheet's `#liveOf`) the site's style, uses left,
    Automatic, and real values in brackets (`realValues`, hidden by `system.hideRealValues`). Without `live`, as printed: what
    reads its HTML for "(N)-" (the [Constant] lines, harnesses) relies on that.
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
