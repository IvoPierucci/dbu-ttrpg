Crafting - the pieces an Item is built from, where an Item is built rather than picked from a
list: Apparel, and Weapons.

One folder per kind of piece:

  apparel-categories/   the four Apparel Categories. An Apparel is one of them.
  apparel-qualities/    the Apparel Qualities. An Apparel has as many as its Craftsmanship
                        Grade gives Quality Slots - more is allowed, and the Item's sheet
                        says it is over.
  weapon-categories/    the Weapon Categories, three or four to each Weapon Type.
  weapon-qualities/     the Weapon Qualities, Special ones among them.

A file here is a Trait like any other: `id`, `name`, `description` (the hover), `text` (the
rulebook's wording), and a script after `---` once its effects are built. Every file has to be
listed in traits/index.json.

A built Item does not run these files. It has Effects of its own - `system.crafted.effects`,
its Effects tab - and its Category and each of its Qualities write their script into it when
they are chosen, between markers:

  #@ quality durable | Durable
  [passive]
  piece.breakValue += 3;
  #@ end

From then on the piece does what its Effects say and nothing else: change a part, or write
lines of your own outside every part, and that is what it does. Taking a Quality off takes its
part out; changing the Category writes the new one's part and takes out the parts of the
Qualities it does not take. "Re-sync" on the tab replaces all of it - parts and your own
lines alike - with what the Category and Qualities write.

Written into a part: `$choice` becomes what was chosen for the Quality when it was added, and
`$slots` the Quality Slots it was given. `$apparelBonus` stays, and is the piece's own Apparel
Bonus per base Tier wherever it is read. A Quality with `noStack: true` has its part marked
`nostack`; one with a `toggle` has its lines kept as `#off` comments while switched off.

What a piece is, rather than what it does to its wearer, is written as a `piece.` Slot -
`piece.breakValue`, `piece.hardnessValue`, `piece.countsForPenalty = false;` and the rest,
listed in WRITING-EFFECTS.txt.

Headers only a Category reads:

  craftDCShift:  Difficulty Categories added to the Craft DC its Craftsmanship Grade gives -
                 Standard Clothing's -1.

Headers only a Quality reads:

  slots:         the Quality Slots it takes - `2`, or a range `1-3` the player picks from when
                 adding it. One when it says nothing.
  categories:    the Categories it may go on, by id - `armor, combat-clothing`. Any, when it
                 names none.
  categoriesExcept: the Categories it may not - "All (except Weights)" is `weights`. One that does not fit - its Apparel's Category changed after - is
                 kept, and inactive.
  prerequisites: as printed. "Not applied to the crafter, but the wearer": while the wearer
                 does not meet them, the Quality does nothing - asked in its script with an
                 `if`, around everything it does.
  choices:       a list of its own to choose from when it is added, `key=Label` each -
                 Focal's `strike=Strike Rolls, dodge=Dodge Rolls`.
  chooses:       `weather`, for a type of Battle Weather chosen when it is added.
  chooses:       `skill`, for a Quality that has one chosen when it is added; with
                 `choiceAttribute: personality`, only the Skills that use that Score. Its
                 script names the one chosen as `$choice` - `skill.$choice += 2;`.
  toggle:        a label for a switch on its row: its part's lines are kept as `#off` comments
                 while the player has it off - Team Outfit's teammates, which the table keeps.
  noStack:       true - its part is marked `nostack`, the rulebook saying so of it. Worn on
                 several pieces, every Quality applies from one anyway - Double Dip, see
                 doubleDipped() in module/effects/registry.mjs.
  summary:       what it does: its Effects line as printed, word for word, cut into one line to
                 an effect with a blank line between, each opening with its tag as the rulebook
                 writes one - `[Passive]:` while worn,
                 `[Automatic, 1/Encounter]:` for one that happens without asking, `[Triggered]:`
                 for one its wearer may use. Shown as its Effects on its Item's Qualities tab,
                 with its `prerequisites` first.
  renameable:    true - named by its owner on the piece, which is the name its row, its part
                 in the Effects and the workings go by - Dynamic, a Quality of the player's own.
  special:       true - a Special Apparel Quality: offered apart in Add Quality, "typically
                 gained through your ARC granting you unique pieces of Apparel". More than one
                 on a piece is said on its sheet, never refused.
  excludesQualities: a Quality that, on the same piece, keeps this one from applying at all -
                 Durable's `lightweight`.
  requiresQualities: a Quality it needs on the same piece to apply at all.

A Quality held off - by its Category, or by one of those two - is kept on the piece and said to
be inactive on its row, and its part is not written into the piece's Effects.

A Quality's script may also name its own piece's Apparel Bonus as `$apparelBonus`, per base
Tier - `parry += ceil($apparelBonus(bT) / 2);` is "1/2 (rounded up) of the Apparel Bonus".

A piece's Effects run while it is worn: its `piece.` lines say what the piece is, and the rest
what it does to its wearer. Its Category's part runs only while it is the Top Layer - or, with
nothing on the Top Layer, the highest Layer worn: "benefits that you gain while wearing that
piece of Apparel as the Top Layer". Its Qualities' parts, and lines of its owner's own, run on
any Layer.

"If an effect would apply an Apparel Quality to a piece of Apparel that has all of its Quality
Slots filled, you may remove any number of Apparel Qualities before applying that additional
Apparel Quality." - Qualities are taken off on the Item's own sheet, whenever.

The Craftsmanship Grades themselves - Craft DC, Apparel Grade, Quality Slots, Apparel Bonus -
are one table, in module/gear.mjs as CRAFTED.

--- Weapons ---------------------------------------------------------------------------------------

A Weapon is built the same way, with a Weapon Type (Physical/Energy/Magic) and a Weapon Size
(Small/Standard/Big) beside its Grade and Category. Its Size's rolls and the Weapon Penalty are
the system's; everything else it does is its own Effects.

What it does to "Attacking Maneuvers made with this Weapon" is written against `weapon.` Slots -
`weapon.wound += 2(T);`, `weapon.kiCost -= 2(T);` - and read off it when an attack is declared
with it. What it does while merely wielded - the Magic Staff's "While wielding this Weapon" - is
written against the character's own Slots, and runs for as long as it is in hand. Its whole
part runs whichever Weapon it is, Category included: there are no Layers.

Tokens a Weapon's Effects may name, written in for the attack being made: `$simple`,
`$calledShot`, `$aoe`, `$lineAoe`, `$halfWager` (1 or 0 each), `$belowEnormous` (Size Categories
its wielder is under Enormous) and `$sizeRank` (1, 2, 3 for Small, Standard, Big). See
WEAPON_TOKENS in module/gear.mjs.

Headers only a Weapon's pieces read:

  weaponType:    a Category's Weapon Type - the Categories offered are the Type's.
  possesses:     a Category's Qualities it comes with, outside the Quality Slots - Bludgeoning's
                 `staggering`. Their code is written into the Category's own part.
  types:         the Weapon Types a Quality may go on - `physical, energy`. Any, when it names
                 none ("Weapon Type: All").
