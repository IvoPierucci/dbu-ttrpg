# Changelog

What each version brought, in broad strokes. Every change is described in its commit message (`git log`). Add to
**Unreleased** as you work; when an owner bumps the version, the Unreleased heading becomes that version.

## Unreleased

- **The race gives its Racial Traits:** choosing a race (and Subrace) puts its Traits on the character; the Majins pick their 4
  Secondary Traits, and a Minion its 2, on the Progression tab. A race Trait is exchanged for a Factor Trait from its row (the arrows
  in place of the cross), and restored there. Add Racial Trait is hidden behind Settings' Debug. Characters made before have their Racial
  and Factor Traits taken off once and get their race's as their sheet is next opened.
- **New Transformation:** Greater Mutation (a Greater Awakening for the Mutation Factor). New `surge-maneuver` Moment and
  `surge.regainedTimes` Slot: what answers the Surge Maneuver's Surge, and how many times more it gives back.
- **New Transformation:** Saiyan Prodigy (a Super Awakening of the Saiyans, beside Pure Progress). A Resource can now take what
  another can no longer hold (`resourceOverflowOf`, while the flag Slot `resourceOverflowWhen` names is set): its Bottomless Battle
  Born. Trait rows' buttons: no focus ring, and the Automatic one blue when hovered; every Transformation Trait has its pencil.

## 0.3.11 (2026-11-27)

- **New Transformation:** Super Majin (a Greater Awakening of the Majins). The `surge()` verb takes a fifth number: the Surgency
  multiplied for that Surge.
- **New Transformation:** Unkillable Majin, the first Super Awakening. With it, Grand Awakenings: a Trait with `slot: grand` is off
  until its Grand Trigger is met this Combat Encounter (`grandTrigger:` names that effect, which answers meanwhile) and the new
  Full Awakening Maneuver activates it for the Encounter, with 1/4 of the Maximum Life and Ki Points back.
  Opened by hand in Debug's Maneuver Access (a Grand Trigger missed), it activates the character's Super Awakening all the same.

## 0.3.10 (2026-11-27)

- **Minions and Transformations:** a Duplicate (a Goop too) has its Master's Transformations, in the one the Master was in as it is
  made. Another Minion's Awakening Limit is the Minion Awakening Limit by its Master's base Tier of Power; a Super Awakening on a
  Minion is said. A Duplicate has no limit of its own.
- **Fusion Awakenings:** the Fusion tab lists the Fusion's Awakenings, each ticked to have it for this Fusion, with the Fusion
  Awakening Limit used; one unticked is not had.
- **Opening a sheet as the world loads:** it waits for the rules to load ("DBU TTRPG: loading the rules...") and opens complete.
- **A Trait's Maneuvers:** under a Trait also the Maneuvers its own effects open (`allow maneuver.<id>`, its chosen Option's too) -
  Class Up's Choice Maneuver under Class Selection; the Transformation Traits list shows them as well.
- **Core Maneuvers:** a character made before a Maneuver was added to the system (Class Up's Choice Maneuvers, for characters older
  than the Transformations) gets it when the world loads; one deleted on purpose is not given again.
- **Trait text:** an Option's and a Choice's own lines ("Elite [1/Encounter]:") bold and counted like an effect's.

## 0.3.9 (2026-11-27)

- **Traits on the sheet, as the site prints them:** the unfolded text of Racial and Other Traits, Talents and Transformation Traits
  in dbu-rpg.com's font and colours, the name and each effect's number and keywords bold in its yellow. In the keywords, the uses
  left of a limit ("0/Encounter": yellow while all are left, orange once some are spent, red at none), and "Automatic" in blue
  where the effect's button is set so. After each amount, its value for this character in brackets ("1(T) [3]", "1/2 of your Max
  Capacity [48]"); Settings has "Hide real values in brackets".
- **Trait rows:** the Triggered/Automatic button, the pencil and the cross all 18px (Foundry's button `min-height` had kept some
  taller), the row centred on one line with as much room below as above.

## 0.3.8 (2026-11-26)

- **New Transformation:** Super Kaioken, a Special Enhancement of Kaioken (`initial:`, and `onlyAlongside:` for one used only beside
  another and left with it).
- **Respond window:** with Direct Hit, a ticked effect that lowers the Damage Category (Hard as Steel (5), Damage Inhibitor
  (2)) now shows the lower Category in the box above.
- **Amount windows:** spending Adaptation Points says how many you have; Tough Warrior (2), Blaster/Magic Master,
  Skills of a Genius and Power of the Weak say their most as written and in number ("Up to 4(bT) [12]").

## 0.3.7 (2026-11-26)

- **New Transformations:** Boiling Rage (Variant of Enraged) and Steel Frame (Lesser Awakening).
- **Entering a Transformation:**
  - Its card has an Apply effects button for every Triggered/Transform effect, Burst Limits included.
  - Effects that grant out-of-sequence Maneuvers put a button for each on that card. These are Scarlet Multiplier,
    Unleashed Rage, Dark Power Rising, Lightspeed Assault, You Must Die by My Hand!, All-Out Super Saiyan (7) and
    True God of Wisdom (6).
  - Giant's Vantage and Unsealed Instinct are built.
- **Signature Techniques:**
  - Ascended Signature added for one use, by Quick to Master, Earthling-Raised or Genetic Focus: Earthling, now asks to
    ascend and offers Karmic Assault.
  - An Ascended Technique is locked for the rest of the Encounter, and Technique Master's once a Round works. Both were
    recorded under the wrong id.
  - Crimson Sacrifice (5) and Divine Armament dice are shown as their own groups, and the Strike keeps its own Tier of
    Power Extra Dice.
- **New engine pieces:**
  - `sharesUses:` lets two Traits' effects share one limit.
  - New Slots `wound.vsObscured`, `lifeOnWound.upToSurgency`, `wager.anyFromLife` and `clash.corporealForCognitive`.
  - New verbs `offerOneOf`, `studyAll` and `enterLinked`.
- **Documentation:** `CLAUDE.md`, `docs/` (architecture, rulings, adding content, work log), this changelog and
  `tools/reindex.py`.
- **Tests:** the verification battery is in the repository (`tests/`, `bash tests/check.sh`). It is portable, finding
  Foundry through `FOUNDRY_NODE` / `FOUNDRY_APP`.

## 0.3.x (2026-11-20 to 2026-11-21)

- **0.3.6:**
  - Added Time-Skipper and its leftovers: Time Lag's Exploit, Time Prison released by Pinned, and Signature Techniques
    through Time-Skip.
  - "1/2 of G(T)" fixed: it halves G × T.
- **0.3.5 and earlier:**
  - Added Superior Super Saiyan (with Multiple per Stage) and Time Power's Profile and Unique Abilities.
  - Ki past the Maximum, a general free Counter Maneuver path, and the [Permanent] keyword fixed.
  - Every Transformation's "the table's" effects built where the engine could.
- **0.3.0:**
  - Transformations, stages 2 to 7: Awakenings, held-Character Awakenings (Absorption, Unified, Overtaken, Inherited
    Life), entering and leaving, Enhancements, Forms and Lines, Evolved Stages, and what grants them.

## 0.2.x (2026-09 to 2026-11-19)

- **0.2.87:** Transformations, stages 0 and 1: the tab, the Item type, 51 Transformations as data, and 39 Aspects.
- **0.2.86:** added the Vehicles and Fusions Actor types.
- **0.2.76 to 0.2.85:** added Custom Buffs and Adversaries (with Villainous Maneuvers and Quickplay).
- **Earlier 0.2.x:** the character sheet and everything it is built from:
  - Races and Racial Traits, Factors, Talents by Category, Maneuvers, Unique Abilities, Signature Techniques and Super
    Profiles.
  - Gear (Apparel, Weapons, Integrated Items, Buddies), Battlefields, Weather and Environments, Karma, Minions, Adventure.
  - The effects engine, the roll window, chat cards for attacks, Clashes, Damage and Thresholds.
