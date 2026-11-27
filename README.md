# DBU TTRPG

An unofficial Foundry VTT game system for the [Dragon Ball Universe Tabletop RPG](https://dbu-rpg.com).

Not affiliated with or endorsed by the DBU TTRPG authors. Dragon Ball is owned by its respective rights holders.
This repository holds the system's code and the game's rules content.

> **In active development.** Most of the game is implemented, but much of it has been tried at a real table only a
> little. The data model can still change; back up your world before updating.

## Requirements and installation

- Foundry VTT v13 or v14.
- Copy this folder into `Data/systems/dbu-ttrpg` in your Foundry user data directory, then create a world with the
  DBU TTRPG system.

## What is in it

- **Actors:** Characters, Minions (Special and Duplicate), Adversaries (Standard, Elite, Villain, with Quickplay),
  Fusions and Vehicles.
- **Character sheet:** Attributes and Skills, the Power Level progression table, Combat (Life, Ki, Capacity, Actions,
  States and Conditions), Signature Techniques, Unique Abilities, Traits, Gear, Maneuvers, Transformations, Custom
  Buffs, Adventure, Biography and Settings.
- **Content** (2,000+ rules files):
  - Every race with its Racial Traits, Factors and Other Traits, and Talents by Category.
  - Maneuvers, Unique Abilities with Advancements, Signature Technique Advantages and Disadvantages, and Super Profiles.
  - Combat Conditions and States, Apparel, Weapons, Items and Buddies, Battlefields, Weather and Environmental
    Qualities, Karmic Effects.
  - 56 Transformations (Awakenings, Enhancements, Forms, Evolved Stages) with their Aspects.
- **Play:**
  - Maneuvers and attacks are run through chat cards that roll Strike, Dodge and Wound, settle Clashes and apply Damage.
  - Health Thresholds and Steadfast Checks, out-of-sequence offers, and Combat Rounds with the Action economy.

## Contributing

Read [`CLAUDE.md`](CLAUDE.md) first. It holds the project's rules and conventions and is the entry point for both people
and AI assistants. Then, as needed:

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) is a map of the code.
- [`docs/ADDING-CONTENT.md`](docs/ADDING-CONTENT.md) explains how to add Traits, Talents, Transformations and more.
- [`WRITING-EFFECTS.txt`](WRITING-EFFECTS.txt) documents the effects language used in `traits/**/*.dbu`.
- [`docs/RULINGS.md`](docs/RULINGS.md) records how ambiguous rules are read.
- [`docs/WORKLOG.md`](docs/WORKLOG.md) lists open items and what is being worked on.
- [`CHANGELOG.md`](CHANGELOG.md) lists changes by version.
- [`tests/README.md`](tests/README.md) explains the verification battery (`bash tests/check.sh`).
