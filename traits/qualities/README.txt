ENVIRONMENTAL QUALITIES
=======================

One file per Quality. They are Battlefield files like the Light Levels, Cover, the
Battle Weathers and the Battle Environments, and they sit in a folder of their own
for the same reason those do not: four searches already run over traits/battlefields/
and each has to say which files are its own.

    kind: battlefields      (the folder says it - qualities/ loads as battlefields)
    envQuality: true        what the search for Qualities filters on

"Qualities are applied on a Square-by-Square basis and ultimately decided by the ARC
unless an effect directly allows you to apply them." There are no Squares here, so a
character carries the Qualities of the one they are standing in: whatever their Battle
Environment's own file declares, plus whatever the player has ticked on the sheet.

Two headers carry what a script cannot say:

    groundCollision: halves | doubles
        What this Quality does to Collision Damage taken from the ground. Read by the
        collision window, in its Ground Collision branch only - a Feature standing on
        a Square is not the Square.

    hardnessShift: 1
        What it does to the ground's Hardness Rank.
