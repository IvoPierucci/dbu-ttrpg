# Architecture

A map of the code: what each part does and how the parts connect. Line counts are approximate (2026-11). Every module
opens with a comment saying what it is for; read that first.

## The big picture

```
traits/**/*.dbu  ──load──▶  effects engine  ──▶  numbers on the character (Slots)  ──▶  sheets, rolls
 (game content)            (module/effects/)       actor-character.mjs prepare          chat cards
                                 │
                                 └── Triggered/Automatic effects answer Moments ──▶ verbs ──▶ chat.mjs functions
```

There are three layers:

1. **Content as data.** Every Trait, Talent, Maneuver, Unique Ability, Condition, State, Aspect, piece of Gear and
   Transformation is a `.dbu` file under `traits/`. It has a header (`key: value`), the rulebook text verbatim, then `---`
   and a script in the effects language (see [`WRITING-EFFECTS.txt`](../WRITING-EFFECTS.txt)).
   `traits/index.json` lists every file, because a browser cannot list a folder.
2. **The effects engine** (`module/effects/`) compiles those scripts. It folds their passive effects into the
   character's numbers, and runs their Triggered and Automatic effects when a Moment happens.
3. **Foundry glue and the rules machinery.** Data models, sheets and chat cards, plus the parts of the rules that a
   script cannot express: Rounds, attacks, Clashes, Transformations, Fusions and so on.

## Entry point

- `module/dbu-ttrpg.mjs` (~580 lines). On `init` it registers data models, sheets, settings and Handlebars helpers.
  On `ready` it loads the Traits and seeds the Talents. It also holds a number of world-level `Hooks.on(...)`
  (actor and item updates, sizes, links).
- `system.json` holds the manifest, Actor and Item types, compatibility and version.
- `module/content-ready.mjs`: whether `setup`'s loading of the content (and preparing every character with it) is done; the actor
  sheets wait on it before they are drawn, since Foundry does not wait on an async hook.

## The effects engine (`module/effects/`)

| File | What it does |
|---|---|
| `traits.mjs` | Loads every `.dbu` named in `traits/index.json`. Parses the header, keeps the text, compiles the script. `getTrait(id)`, `traitsOfKind(...)`. Under `traits/transformations/`, the subfolder (`traits/`, `unique/`, `maneuvers/`...) says what a file is. |
| `lexer.mjs`, `parser.mjs`, `ast.mjs` | Script → tokens → program. `parser.mjs` holds `PREDICATE_NAMES` / `BARE_PREDICATES` - **a new question must be added there.** |
| `slots.mjs` | **Every value an effect may change**, with its phase (`TIER`, `MODS`, `CORE`, `LATE`) and the operations allowed. A script that writes an unknown Slot is rejected. A new Slot needs a reader somewhere in the code. |
| `amounts.mjs` | Amounts: `1(T)`, `2(bT)`, dice, `$G`-style letters. |
| `conditions.mjs` | The questions an `if (...)` / `requires` can ask (`belowThreshold("injured")`, `inState("raging")`, `hasAdvancement(...)`...). |
| `interpreter.mjs` | Runs programs. `applyPassives` folds passive blocks into Slots by phase. `collectReactive` gathers what a Moment's Triggered/Automatic blocks do (Slot changes and queued verb calls). |
| `registry.mjs` | **The only engine file that knows Foundry.** `programsFor(actor)` gathers every program that applies to a character: its Items (Traits, Talents, Gear...), States, Conditions, Aspects, Transformations, Custom Buffs, Environmental Qualities. It also handles uses per Round/Encounter (`usesLeft`, shared uses) and what is armed or Automatic. |
| `moments.mjs` | The list of Moments (`start-of-turn`, `power`, `transform`, `threshold`, `state/raging`, `declare-maneuver`...) a block can answer. |
| `moments-runtime.mjs` | `fireMoment(actor, moment, context)` runs what answers a Moment, records uses and announces Automatic ones. `runVerb` is the big switch from verb name to implementation, mostly a function in `chat.mjs`. Also `enterState`, `expires`, Resources. |
| `verbs.mjs` | The verbs a script may call (`enterState`, `regainAnyway`, `offerOneOf`...), with argument counts and docs. **A new verb needs both this and a `case` in `runVerb`.** |
| `decompile.mjs`, `migrate.mjs`, `debug.mjs` | Round-trip, old data conversion, the debugging instrument. |

How a character's numbers are made: `module/data/actor-character.mjs` `prepareDerivedData` asks `programsFor` once.
It then applies the passives phase by phase between its own steps (Tier, Attribute Modifiers, the bulk, then Wound,
Might and Thresholds), and leaves every Slot's result and its parts in `system.effects.slots`. The hovers on the sheet
show those parts.

## Data models (`module/data/`)

| File | |
|---|---|
| `actor-character.mjs` (~3,600) | The Character model, used for the `character`, `minion`, `adversary` and `fusion` Actor types. Schema, derived data (Attributes, Skills, Life/Ki/Capacity, Thresholds, dice), the effects pipeline. |
| `actor-vehicle.mjs` | The Vehicle Actor type. |
| `item-*.mjs` | Item types: `maneuver` (Maneuvers, Signature Techniques, Unique Abilities), `talent`, `racial` (Racial, Other and Transformation Traits), `gear`, `transformation`. |

## Sheets and templates

- `module/sheets/actor-character-sheet.mjs` (~9,400) is the character sheet on ApplicationV2. Its `TABS`/`PARTS` map to
  `templates/parts/actor-*.hbs`. Actions are static methods registered in `DEFAULT_OPTIONS.actions`.
- `actor-vehicle-sheet.mjs`, `item-gear-sheet.mjs`, `item-maneuver-sheet.mjs` and `item-talent-sheet.mjs`, with their templates.
- `styles/dbu-ttrpg.css` holds the styles, `lang/en.json` the strings.

## Using a Maneuver and attacking

- `module/use-maneuver.mjs` (~8,500) is the path from clicking a Maneuver to its card. In `useManeuver` → `useManeuverOnce`,
  it does these in order:
  1. Checks whether it may be used.
  2. Picks the Signature Technique through its "door" Maneuver.
  3. Asks the declaration windows (Profile, Ki Wager, the Technique's questions).
  4. Pays Actions, Ki and Capacity.
  5. Fires `declare-maneuver`.
  6. Posts the attack (`postAttack` in `chat.mjs`).
- `module/maneuvers.mjs` (~5,400) holds Maneuver definitions and costs, the Profiles (`PROFILES`), the Super Profiles, the
  attack window, the Ki Wager and its Life/Divine Ki variants.
- `module/technique.mjs`, `technique-use.mjs`, `technique-attack.mjs` and `signature.mjs` cover Signature Techniques: how
  they are built, when they may be used (Ultimates, Ascended), and what their Advantages do to an attack.
- `module/unique.mjs` covers Unique Abilities and Advancements.

## Chat cards (`module/chat.mjs`, ~44,000 lines)

Most of the rules machinery lives here: attack cards, Strike/Dodge/Wound rolls, Clashes, Damage, Steadfast Checks,
Moment cards (start of turn or Round, Threshold, Defeated, Transform), out-of-sequence offers, and the implementations of
most verbs. Find what you need by searching for the rule's name; comments quote the rule they implement.

Patterns used throughout:
- **State lives in message flags.** An attack card keeps `flags.dbu-ttrpg.attack`, a Clash keeps its own flag, and so on.
  `onRenderChatMessage` (the `renderChatMessageHTML` hook) redraws buttons from the flags on every render.
- **Edits go through `requestEdit(message, {type, ...})`.** The author or the GM applies them; anyone else sends them
  through the socket (`game.socket`, channel registered in `registerManeuverSocket`). `applyRequest` dispatches by `type`.
- **Asking a player:** `askPlayerChoice` and `askPlayerAmount` open a window on the owning player's client, through
  `User#query` when another client runs the code. `prepareRoll(..., {rolling: false})` is the "Apply effects" window.
- **Out-of-sequence offers:** rows with a **Use** button on an existing card (`oosOffers` flag, `takeOutOfSequence`).
- **Who sees numbers:** `maySeeRolls(actor)`. Stats that could be worked backwards are shown only to the character's
  Observers.

## Combat, Rounds and Actions

- `module/combat.mjs` covers Combat Rounds, turns, the Action economy (Actions and Counter Actions), start-of-turn and
  start-of-Round cards, Defeat, and hooks that must run on the GM.
- `module/durations.mjs` handles "until the end of your next turn" and the like (`lasting`, edges).
- `module/conditions.mjs` holds Combat Conditions and States as the character carries them (`setCondition`,
  `raiseState`, `lowerState`), and the hooks that fire `state/...` Moments.

## Subsystems (one module each, roughly)

| Area | Modules |
|---|---|
| Transformations | `transformations.mjs` (Awakenings, Enhancements, Forms, Evolved Stages, Aspects combined, Stress Tests, entering and leaving), `aside.mjs` (which Traits apply right now) |
| Racial and Other Traits | `racial.mjs` (adding Traits, Options, what a Trait grants; `racialTraitLines(item, live)` - a Trait's text on the sheet, with its uses left, Automatic and real values), `races.mjs`, `genetic.mjs` |
| Gear | `gear.mjs` (Apparel, Weapons, Items, Buddies), `integrated.mjs`, `natural-armor.mjs`, `features.mjs` |
| Battlefield | `environments.mjs`, `weather.mjs`, `light.mjs`, `breath.mjs`, `hidden.mjs`, `guidance.mjs` |
| Allies and Minions | `allies.mjs` (`areAllies`, `areOpponents`), `minion-make.mjs`, `token-marks.mjs` |
| Fusion | `fusion.mjs`, `fusion-make.mjs`, `fusion-traits.mjs`, `fusion-dance.mjs`, `fusion-of-ki.mjs` |
| Adversaries | `adversary.mjs`, `villainous.mjs`, `change-type.mjs` |
| Vehicles | `vehicles.mjs`, `vehicle-crew.mjs` |
| Karma | `karma.mjs`, `desperation.mjs` |
| Other | `adventure.mjs`, `custom-buffs.mjs`, `duel.mjs`, `united-attack.mjs`, `talents.mjs`, `talent-categories.mjs`, `dice.mjs`, `breakdown.mjs` (roll breakdown rows), `search.mjs` |

## Content folders (`traits/`)

Each folder has a README. The folder decides what a file is:
- `races/`, `factors/`, `other/`, `talents/`, `maneuvers/`, `unique/`, `signature/`, `conditions/`, `states/`, `aspects/`, `karma/`
- `gear/`, `crafting/`, `qualities/`, `battlefields/`, `high/`, `adventuring/`, `vehicles/`
- `transformations/<type>/<id>/`: one folder per Transformation, holding everything it owns (its Traits, Unique
  Abilities, Maneuvers, Conditions, States).

`races/*.json` (outside `traits/`) holds each race's base numbers.

## Tests (`tests/`)

The verification battery is `bash tests/check.sh`: syntax and import checks, then about 130 harnesses run headlessly on
the Node inside Foundry's executable. See [`tests/README.md`](../tests/README.md).

## Tools (`tools/`)

`reindex.py` keeps `traits/index.json` in step with the files on disk.
