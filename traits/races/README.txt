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

Two things to remember:

  - Add the file to traits/index.json. A browser cannot list a directory, so
    nothing is found that is not named there.
  - Taking a Trait is a choice made on the character sheet, under Racial Grants
    in the Progression tab. Putting a file here offers it; it does not grant it.

Nothing is here yet. The machinery is in place and checked, but the Traits
themselves are rules text, and rules text is not something to invent.
