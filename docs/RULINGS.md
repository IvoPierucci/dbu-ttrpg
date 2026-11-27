# Rulings

How the project owners read rules that the rulebook leaves open, and the conventions the system follows. **Check this
before asking or deciding on your own.** Add a new ruling here when an owner gives one, with its date. Each entry says
the rule and how it is applied in the code.

## Numbers

- **Rounding is down** unless the text says "rounded up". Use `floor` everywhere else; `ceil` only for "rounded up".
- **"1/2 of G(T)" halves the whole amount**, G × T: `ceil($G * 1(T) / 2)`, never `ceil($G / 2) * 1(T)`. Read the
  wording, though: "x(T), where x is 1/2 of Y" halves Y first.
- **Doublings stack.** Two *different* effects that each double the same value multiply (×4). Build them as a
  multiplier per source, not a boolean.
- **Double Dip goes by name, not by effect.**
  - The same Trait, Talent, Quality, Advantage or Disadvantage counts once per character.
  - Two differently named things that both give +2(T) give +4(T).
  - The same Quality on two pieces of gear counts once. A piece's own stats (its Life Points, Hardness, Break Value)
    stay per piece.
- **Skill Bonus** = floor(governing Attribute **Score** / 2) + 2 per Rank + Size step, then effects. Raising the Skill
  Check or the Skill Bonus is the same to the player, so hovers show one sum.
- **Sphere AoE radius in Squares:** Minor 1, Standard 3, Large 4, Huge 5, Destructive 6 (`guidance.mjs SPHERE_RADIUS`).

## Keywords

- **[Passive]** applies by itself.
- **[Triggered]** means the player chooses. Build it as a button or a tick in a window. Never apply it automatically,
  and spend its use only when it is used. This is the most common mistake to avoid.
- **[Automatic]** applies by itself at its Moment.
- **[Permanent]** is a Passive that persists outside its Transformation, for example "This is a Super Saiyan (1)"
  (loses Power High, gains Natural). With **[Permanent, Option]**, what persists is *the Option chosen*. The Option's own
  [Passive] effects still work only inside the Transformation.
- **[Constant]** (Transformation Traits only) is a [Triggered] effect that is also offered while you are *outside* the
  Transformation (header `constant: N`).
- **[Acclimated]** (Evolved Stages) applies only while the Original Form is Mastered (or Fully Mastered, if the effect
  says so).
- **Outside a Transformation you don't have its Traits.** Their effects don't apply, and you don't count as having the
  Trait. The exceptions are [Permanent] and [Constant] effects, the Legendary Trait (while the Form *is* Legendary) and
  Awakenings, which always apply.
- **Triggered/Defeated** effects are rare and limited to one per Encounter. A plain "would reduce your Life Points to 0"
  without the /Defeated keyword uses the `lethal-damage` Moment, outside that limit.

## Out of sequence and chat cards

- **One Out-of-Sequence Maneuver per trigger.** Chains are fine, because each link is its own trigger. An effect that
  grants an Out-of-Sequence Maneuver is never Automatic: it carries the `outOfSequence` block keyword and is chosen as it
  happens.
- **Out-of-Sequence Maneuvers from the sheet:** the Maneuvers tab's **Manage** has a toggle and an Actions box. Never add a
  per-Maneuver "OOS" button.
- **No extra chat cards.** Offers go on the card that already exists (turn, Round, attack, Transformation). Use the
  `oosOffers` rows or its **Apply effects** button.
- **Entering a Transformation:** its card is the Transform Moment's card.
  - **Apply effects** there lists every Triggered/Transform effect, Burst Limits included. What the player ticks applies
    right then.
  - An effect that hands over Maneuvers out of sequence ("use X, Y or Z") puts one button per Maneuver on that card, using
    `offerOneOf`. Taking one hides the others.
  - What the effect gives (Life, Ki, a State) is given when it is activated, not when the Maneuver is used.
- **Cards roll themselves.** A Check against a known Difficulty is rolled on the card and settles itself. Keep the text
  short: no "Made it / Failed it" buttons, and re-judge it if a reroll changes it.
- **Who sees numbers:** stats that could be worked backwards (Max Life, Soak, Damage Reduction, Might, totals) are shown
  only to that character's Observers and the GM (`maySeeRolls`). An attack's Damage is shown only to the target's
  Observers.
- **Secrets stay with the ARC (GM).** An effect that makes you "aware" of another character's hidden info (Alignment,
  Power Level...) reveals nothing on the card. The GM tells the player or keeps it back.

## How a Trait's text shows on the sheet (the owner's, 2026-11-27)

- **As dbu-rpg.com prints it:** the chat's palette and font; the Trait's name and each effect's number and keywords bold in the
  site's yellow. The name on the folded row is yellow too.
- **Uses left replace the limit's number** in the keywords ("[Triggered, 0/Encounter]"): yellow while all are left, orange once
  some are spent, red at none.
- **"Triggered" reads "Automatic"** (blue, as is its button) while the effect's Triggered/Automatic button is set Automatic.
- **Each amount's value for this character follows it in brackets** - the owner's spreadsheet convention: "1(T) [3]", "Z(bT) [6]",
  "1/2 of your Max Capacity [48]". Rounded down unless the text says up. Shown by default; Settings can hide them.
- The row's buttons are all one height (18px), the row centred on one line.

## States, Thresholds, Critical

- **States** are only Mindful, Raging, Superior, Surging and Undying. Everything else (Dead, Determined, Drunk, Feral,
  Entrusted, Spectator, God Ki...) is a **Special State**, entered only through an effect (header `specialState: true`).
- **State levels stack.** Entering a State you are already in raises it a level for that effect's duration; each ending
  lowers it again. Use `enterState` or `raiseState`, never `setState(..., 1)` plus a clock.
- **Health Thresholds are lines you fall through.** "Below Injured" means Injured or Critical (`belowThreshold("injured")`).
  "Above Injured" means Healthy or Bruised.
- **Critical and Botch:**
  - An effect that "sets the Natural Result to 10" sets it, which scores a Critical. Other effects score a Critical
    "regardless", and the die keeps its number.
  - A roll can be Critical and Botch at once.
  - Natural Result raises affect only the Base Die, and never go above 10.

## Characters and sides

- **Allies are the Settings tab's Allies list**, and the relation is mutual. Token disposition never matters.
  - Use `areOpponents(a, b)` for "Opponent", never `!areAllies`. A Minion is on its Master's side.
- **The race gives its Racial Traits (the owner's, 2026-11-27; until then they were added by hand).** Choosing a race (and Subrace) puts
  all its Primary, Secondary and Subrace Traits on the character. A race that says how many Secondary Traits are chosen
  (`secondaryChoices` in its JSON - the Majins' 4) has them picked on the Progression tab. A Minion (not a Duplicate, not of a Minion Race)
  has its Primary Traits and picks two of its Secondary and Subrace Traits there; a Minion Race's keeps all. Changing the race replaces
  every Racial and Factor Trait. A race Trait is exchanged for a Factor Trait from its row - a Secondary for a Secondary Factor Trait, a
  Primary only for one that names it - and restored the same way; Factor Traits not the character's are dimmed with why, never refused.
  Add Racial Trait is hidden, back with Settings' Debug "Show Add Racial Trait". Characters made before had their Racial and Factor Traits
  taken off once, given their race's again as their sheet was next opened; their exchanges and picks were made again by hand.
- **Requirements are warned about, never refused.** This covers Race, Tier of Power, Prerequisites, Quality slots, the
  Awakening Limit and Mastery caps.

## What the system leaves to the table

- **Things the group says out loud are the table's on purpose.** Examples: who a Compelled character's target is, which
  Squares a cloud covers, where a token is placed. Implement the part that changes numbers; treat the narrated part as
  given; and write "the table's" in the file's comments with the reason.
- **"Typically" rules** (for example, High Environmental Qualities) go in the written rules lists only, never enforced.
- **Rules from the site:** only from a link an owner gives. Never read dbu-rpg.com on your own initiative. Copy the
  text verbatim.

## Transformations

- **Grand Awakenings (2026-11-27, my readings):** a Grand Trigger detected by the system is met by itself (Unkillable Majin's: a
  Healing Surge that leaves you in Bruised, so from Injured or Critical). The Full Awakening Maneuver is a Standard Maneuver (its entry
  gives no Maneuver Type). The Grand Awakening stays active until that Combat Encounter ends.
- **Saiyan Prodigy (2026-11-27, my readings):** Bottomless Battle Born is taken whenever a Battle Born would be lost for being full in
  the Flow State (its "you may" never worth refusing); its bonus counts only in the Flow State. Bottomless Combat Prowess (4) is offered at
  the start of your turn beside Combat Imprinting (1), taken when that gave a stack.

- **Minions and Fusions (2026-11-27, my readings, not yet the owner's):** a Duplicate's Transformations are its Master's as they
  were when it was made, with no Awakening Limit of its own. A new Fusion has every Fused Character's Awakening ticked; the table
  unticks those it does not have, over the Fusion Awakening Limit said and never refused.

- **Lines:** a Stage inherits the Traits of the Stages before it, but not their Attribute bonuses or Aspects.
- **Variants:**
  - A Variant inherits the original's Traits except the ones it replaces (named in brackets).
  - Its own Burst Limit, Mastery, Transcendent or Legendary Trait replaces the original's. If it has none, it inherits
    the original's.
  - A Peaked Variant inherits no Mastery Trait.
- **Stacking:** the higher Stress Test Requirement plus half the other's, **rounded down**. Only one Burst Limit per
  Encounter in total.
- **Requirements** (Race, Tier of Power, Prerequisites) are never enforced. Entering or staying is the table's.
- **Aspects** exist once each, in `traits/aspects/<id>.dbu`. A Transformation only names them; never write an Aspect's
  effect inside a Trait. Grant one with `grantsAspectTo:`.
- **Kaioken's Life Point Cost** is charged by itself when an Attacking Maneuver is declared.
- **"Until the end of your next turn" for Studied** is kept by the Round: through the end of the next Combat Round.
