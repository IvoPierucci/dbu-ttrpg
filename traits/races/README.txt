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

Two things to remember:

  - Add the file to traits/index.json. A browser cannot list a directory, so
    nothing is found that is not named there.
  - "You gain access to all Primary & Secondary Racial Traits listed on your
    race": every file here is had by every character of that race - a Subrace's
    only by that Subrace. The Progression tab lists them; clicking one marks it
    lost ("If you lose a Racial Trait, through any means").

Still the table's: keeping a Talent or Technique Points a lost Trait gave, and a
Signature Technique made with a Profile a lost Trait gave. A Trait that grants a
Unique Ability grants it with no Requirements and no Technique Points.
