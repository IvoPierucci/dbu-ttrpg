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
                 names none. One that does not fit - its Apparel's Category changed after - is
                 kept, and inactive.
  prerequisites: as printed. "Not applied to the crafter, but the wearer": while the wearer
                 does not meet them, the Quality does nothing. Read when Apparel is worn.

"If an effect would apply an Apparel Quality to a piece of Apparel that has all of its Quality
Slots filled, you may remove any number of Apparel Qualities before applying that additional
Apparel Quality." - Qualities are taken off on the Item's own sheet, whenever.

The Craftsmanship Grades themselves - Craft DC, Apparel Grade, Quality Slots, Apparel Bonus -
are one table, in module/gear.mjs as CRAFTED.
