Crafting - the pieces an Item is built from, where an Item is built rather than picked from a
list: Apparel now, and Weapons the same way when they arrive.

One folder per kind of piece:

  apparel-categories/   the four Apparel Categories. An Apparel is one of them.
  apparel-qualities/    the Apparel Qualities. An Apparel has as many as its Craftsmanship
                        Grade gives Quality Slots - more is allowed, and the Item's sheet
                        says it is over.

A file here is a Trait like any other: `id`, `name`, `description` (the hover), `text` (the
rulebook's wording), and a script after `---` once its effects are built. Every file has to be
listed in traits/index.json.

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
  narrowsCategory: true - its choice is the one Combat Roll its Category's effects reach, as
                 Focal's is for Weights. Read by the Category, through narrowedRoll().
  chooses:       `skill`, for a Quality that has one chosen when it is added; with
                 `choiceAttribute: personality`, only the Skills that use that Score. Its
                 script names the one chosen as `$choice` - `skill.$choice += 2;`.

  apparelBonus:  what it adds to its Apparel's Apparel Bonus, per base Tier - Dense Armor's 1.
                 Part of the Bonus wherever it is read, worn or not.
  breakValue:    what it adds to the most its Apparel's Break Value can be - Durable's 3.
  hardnessValue: a Hardness Value it sets its Apparel's to outright - Hefty Plating's 4.
  wornOverArmor: true - its Apparel may go on over Armor, the Jacket's. Read by the Layers.
  sparesFirstBreak: true - the first loss of Break Value from full each Combat Encounter does
                 not happen, Joint Protection's. Read by the Break Value.
  noApparelPenalty: true - its Apparel does not count towards the Apparel Penalty,
                 Lightweight's and Sleek Design's. Read by the Penalty, as `countsForPenalty`.
  armorDamageReduction: what the Armor Category's Damage Reduction from its Apparel is
                 multiplied by - Sleek Design's 0.5.
  spikes:        true - a Physical blow landing on its worn Apparel costs the one who struck its
                 Apparel Bonus in Life Points, if adjacent - Spiked's. A card asks the Square.
  doffsWithNoEffort: true - its Apparel may be Doffed through the No-Effort Maneuver, Loose's.
                 Read by removing Apparel.
  doffRoundsPerSlot: Combat Rounds its Apparel's first Doff Bonus of an Encounter lasts longer,
                 for each Slot it takes - Segmented Weight's 1. Read through doffRounds().
  excludesQualities: a Quality that, on the same piece, keeps this one from applying at all -
                 Durable's `lightweight`.
  requiresQualities: a Quality it needs on the same piece to apply at all.
  ignoresEnvironments: true - the wearer ignores the Battle Environment's effects.
  ignoresEnvironmentalQualities: true - and its Square's Environmental Qualities'. Both read
                 off the worn Apparel, since they decide which effects are gathered at all.

A Quality held off - by its Category, or by one of those two - is kept on the piece, said to be
inactive on its row, and adds nothing anywhere.

A Quality's script may also name its own piece's Apparel Bonus as `$apparelBonus`, per base
Tier - `parry += ceil($apparelBonus(bT) / 2);` is "1/2 (rounded up) of the Apparel Bonus".

A Quality's script runs while the Apparel it is on is worn, and its Category takes it.

"If an effect would apply an Apparel Quality to a piece of Apparel that has all of its Quality
Slots filled, you may remove any number of Apparel Qualities before applying that additional
Apparel Quality." - Qualities are taken off on the Item's own sheet, whenever.

The Craftsmanship Grades themselves - Craft DC, Apparel Grade, Quality Slots, Apparel Bonus -
are one table, in module/gear.mjs as CRAFTED.
