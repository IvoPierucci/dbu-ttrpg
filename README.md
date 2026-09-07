# DBU TTRPG

An unofficial Foundry VTT implementation of the
[Dragon Ball Universe Tabletop RPG](https://dbu-rpg.com).

Not affiliated with or endorsed by the DBU TTRPG authors. Dragon Ball is owned by
its respective rights holders; this repository contains only game-system code.

> **Early development.** The character sheet works, but the system is incomplete
> and its data model still changes in ways that break existing actors. Create new
> characters rather than migrating old ones.

## Requirements

Foundry VTT v13 or v14.

## Installation

Copy this folder into `Data/systems/dbu-ttrpg` in your Foundry user data
directory, or install it by manifest URL once one is published.

## What works

- **Character sheet** on the modern ApplicationV2 API, with Main, Progression and
  Biography tabs.
- **Attributes** — Scores derived from the progression table, with the Aptitudes
  and Saving Throws that come off them.
- **Progression table** for Power Levels 1-30, reproducing the published Power
  Level table. Each option unlocks exactly one column and fixes the rest.
- **Skills** — all 21, with Ranks fed from Skill Improvement rows and Tier of
  Power rank caps enforced as of the Level each Rank was earned.
- **Races** — all 18 playable races, as editable data files. See
  [`races/README.md`](races/README.md).
- **Life and Ki**, Tier of Power and Breakthrough, Technique Points, and checks
  with critical and botch handling.

## Not implemented yet

Talents, Transformations, traits and racial effects, Items, and the Signature
Technique budget granted at Power Level 1.

## Adding content

Races are plain JSON files under [`races/`](races/) — drop a file in, add it to
the index, reload. No code required.
