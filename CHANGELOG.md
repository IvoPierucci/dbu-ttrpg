# Changelog

What each version brought, in broad strokes. Every change is described in its commit message (`git log`). Add to
**Unreleased** as you work; when an owner bumps the version, the Unreleased heading becomes that version.

## Unreleased

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
