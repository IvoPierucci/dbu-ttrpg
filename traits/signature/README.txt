SIGNATURE TECHNIQUE FEATURES
============================

A Signature Technique is built by its owner rather than handed to them: they pick
Advantages that make it do more and Disadvantages that make it do less, and pay for
the result in TP. This folder holds the two lists.

    traits/signature/advantages/charging-assault.dbu
    traits/signature/disadvantages/<name>.dbu

The subfolder is the side. A file in advantages/ is an Advantage and a file in
disadvantages/ is a Disadvantage; nothing else distinguishes them, and they are
written and loaded identically.

A feature is NOT an Item. The Signature Technique is the Item, and what it was built
out of is named inside it - so a character who owns three Techniques with Charging
Assault has one file on disk, named three times, rather than three copies that can
drift apart.

HEADER
------

    id:           the name used to refer to it, kebab-case
    name:         as the rulebook writes it
    kind:         signature
    side:         advantages or disadvantages - matching the folder
    tpCost:       what it costs to put on a Technique. Disadvantages give TP back,
                  so theirs is written negative.
    requirement:  what a Technique must already have for this to be allowed, or N/A
    description:  a sentence of flavour
    text:         the rule itself, as printed

WHAT GOES IN THE SCRIPT
-----------------------

The same effect language as any other Trait; see WRITING-EFFECTS.txt.

Some features have no script and should not have one. A feature whose rule is about
the map - where you may move, what you can see, how far something reaches - is the
table's to apply, because the player moving the token has already answered it. Where
such a rule turns into arithmetic, the system asks for the one number it needs and
does the arithmetic; charging-assault.dbu is written that way and says so.

Add a file here and name it in traits/index.json. Nothing scans the directory: a
browser cannot list one, and the permission that would let it is not one an ordinary
player has.
