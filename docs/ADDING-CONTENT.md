# Adding content

Most game content is a `.dbu` file under `traits/`. The language is documented in
[`WRITING-EFFECTS.txt`](../WRITING-EFFECTS.txt), and each folder's README lists its header fields. Below are the recipes
that have worked, with the steps people tend to miss.

## The steps every time

1. **Get the rules text from an owner.** Copy it verbatim into `text:` (and `description:` for the flavour line).
2. **Copy a similar file next to it** and edit it. A file of the same kind is the best template: a Talent from
   `traits/talents/`, a Racial Trait from `traits/races/<race>/`, a Transformation from `traits/transformations/`.
3. **Write the script** effect by effect. Mark each block with its printed number:
   `[passive, effect 2]` or `[triggered/power, 1/round, effect 5]`. Put a comment above it saying what it does. Where
   code does part of it, say where (`# (3) ... (chat.mjs lifeOnWoundAsked)`). Where nothing does, say why it is
   "the table's".
4. **Register the file:** run `python tools/reindex.py --write`, which adds new files to `traits/index.json` and drops
   deleted ones.
5. **Check it.** Run `bash tests/check.sh`. Its `compile-traits` harness compiles every file and names any that fail,
   with the line. Add a check for what you built to the area's harness (see [`tests/README.md`](../tests/README.md)).
   Then reload Foundry and try it on a test character: the sheet's hovers show each Slot's parts by source.
6. **Commit** as [`CLAUDE.md`](../CLAUDE.md) describes, saying what was your own reading.

## What exists to reuse

Before writing new code, search for what already exists:
- **Slots:** every value an effect may change, in `module/effects/slots.mjs`. Search by the rule's words: `wound`,
  `soakValue`, `damageReduction`, `strike.<foundation>`, `dice.extra.category`...
- **Predicates:** what an `if (...)` can ask, in `module/effects/conditions.mjs`.
- **Moments:** what a Triggered or Automatic block can answer, in `module/effects/moments.mjs`.
- **Verbs:** what a script can do, in `module/effects/verbs.mjs`. Each verb's `doc` names its first user.
- **Similar effects:** grep `traits/` for the same wording. Many rules repeat (Direct Hit's Damage Category,
  "spend Life Points up to X on the Wound", "as an Out-of-Sequence Maneuver"...).

## When the language can't say it

Add the smallest **general** piece, named for what it does, never for one Trait.

| New piece | Where it goes |
|---|---|
| A **Slot** (a value) | `module/effects/slots.mjs`, plus **its reader**, the code that uses the value. A Slot nobody reads does nothing. That has been the cause of every "it does nothing" report so far. A flag Slot uses `ops: ["allow", "set"]`. |
| A **predicate** (a question) | `module/effects/conditions.mjs` **and** `module/effects/parser.mjs` (`PREDICATE_NAMES` if it takes arguments, `BARE_PREDICATES` if not). Without the parser entry it silently never applies. |
| A **verb** (an action) | `module/effects/verbs.mjs` (argument counts, which arguments are bare names, a `doc`) **and** a `case` in `runVerb` in `module/effects/moments-runtime.mjs`. The implementation usually goes in `module/chat.mjs`. |
| A **Moment** (a trigger) | `module/effects/moments.mjs`, plus a `fireMoment(actor, "<id>", context)` where it happens. If the player chooses, also an `offerTriggers(...)` or an Apply effects button on the card of that moment. |
| A **header field** | Read it where it is used, through `getTrait(id).<field>`. Document it in that folder's README. |

## Recipes

### A Talent
`traits/talents/<id>.dbu` with `talentCategory:`, `prerequisites:`, `text:` and a script. Talents are given by
Progression rows or by Racial Traits; the sheet lists them by category (`module/talent-categories.mjs`).

### A Racial, Factor or Other Trait
- `traits/races/<race>/<id>.dbu`, with `category: body|mind`, `importance: primary|secondary`, `order:`.
- `traits/factors/<factor>/` for Factor Traits. `traits/other/<group>/` for Evolution, Bestial, Monstrous, Vocation...
- Options are their own files beside the Trait.
- A Trait can grant things through headers: `grantsTransformation:`, `grantsRacialOf:`, `grantsUnique:`...

### A Unique Ability
`traits/unique/<id>.dbu`. Its Advancements and Restrictions go in `traits/unique/<id>/<child>.dbu`
(`advancement: true` / `restriction: true`). The character's Item keeps only what was chosen; everything else is read
from the file every time, so editing the file reaches existing characters. See `module/unique.mjs`.

### A Maneuver
`traits/maneuvers/<id>.dbu`, with `type:`, `actionCost:`, `kiCost...`, `usageLimit:`, and `special: true` for a
Special Maneuver.

### A Transformation
- **One folder per Transformation:** `traits/transformations/<awakenings|enhancements|forms/alternate|forms/legendary|evolved>/<id>/`.
  - `<id>.dbu` holds the header (`type`, `subtype`, `racial`, `prerequisites`, `tier`, `stress`, `aspects`, `bonuses`,
    `maxStacks` for Awakenings, `variantOf`, `initial` (a Special Enhancement's Initial Enhancement), `onlyAlongside`, `line`/`stage`,
    `grades`...) and the whole page's text.
  - `traits/<trait>.dbu` holds each Transformation Trait, with `slot: trait|burst|mastery|transcendent|legendary`,
    `mastery: N`, `replaces: <name>` (in a Variant) and `constant: N`.
  - `unique/`, `maneuvers/`, `conditions/` and `states/` hold anything else it owns.
- **Everything it owns stays in its folder.** `module/` and `templates/` never name it.
- **Aspects:** name them in the header; their effects live in `traits/aspects/`. A Trait that changes Aspects uses
  `aspects: -Draining, +Natural 1` or `grantsAspectTo: This = Armored if states.raging >= 3`.
- **Two Traits' effects that share one limit:** header `sharesUses: 1 = steaming-fury 3`.
- **Burst Limits and other Triggered/Transform effects:**
  - `[triggered/transform, 1/encounter, effect 1]`. The player ticks it with Apply effects on the entering card.
  - If it grants Maneuvers out of sequence, add the `outOfSequence` keyword and use `offerOneOf(power-up, movement, ...)`
    for the buttons.

### Gear, Qualities and Environments
`traits/gear/`, `traits/crafting/` (Apparel and Weapon Qualities), `traits/qualities/` (Environmental Qualities) and
`traits/battlefields/`. Each folder's README gives its fields.
