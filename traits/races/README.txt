RACIAL TRAITS
=============

One folder per race, named with the race's own id as it appears in races/index.json:

    traits/races/android/regeneration.dbu
    traits/races/saiyan/zenkai.dbu

The folder a file sits in says two things, and the loader reads both. The first
says what kind of Trait it is - and so where it sits on the Priority ladder, which
for a Racial Trait is above a Talent and below a Combat Condition. The second says
which race it belongs to, and that is what filters the list on a character's sheet:
a Saiyan is never offered an Android's.

A file is written exactly like any other Trait. See WRITING-EFFECTS.txt in the
system's root for the language, and traits/talents/ for worked examples.

    id: regeneration
    name: Regeneration
    description: >
      What the Trait is, in a sentence.
    text: >
      The rulebook's own wording, which is what the sheet shows on hover.

    ---

    [passive]
    soakValue += 2(bT);

Three header lines say what the rules call it:

    category: body          (or mind)
    importance: primary     (or secondary)
    subrace: <subrace id>   (only for a Subrace Trait - which is Primary)
    order: 1                (where it stands among its race's, as printed)

Two things to remember:

  - Add the file to traits/index.json. A browser cannot list a directory, so
    nothing is found that is not named there.
  - A Racial Trait is added by hand, on the Traits tab's Add Racial Trait: the
    character's own race's first, then every other race's by the race's name -
    any of them may be taken (the user's ruling). Removed the same way.
  - Added, it becomes the character's own Item: its Effect tab holds this
    script, and editing it there changes that character alone. More header
    lines (options, choose, grantsUnique, grantsTalent) are explained at the top
    of module/racial.mjs.

Still the table's: keeping a Talent or Technique Points a lost Trait gave, and a
Signature Technique made with a Profile a lost Trait gave. A Trait that grants a
Unique Ability grants it with no Requirements and no Technique Points.
