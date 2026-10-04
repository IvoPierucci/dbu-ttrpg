RACIAL FACTORS
==============

A Racial Factor is a file of its own, and its Factor Traits a folder of the same name:

    traits/factors/ancient-saiyan.dbu
    traits/factors/ancient-saiyan/primitive-durability.dbu

The Factor's file holds no script - only what its page lists, shown beside its Factor
Traits and never enforced (the user's: the system does not control which Racial Traits
a character has):

    requirement: Saiyan      Racial Requirement
    maximumFactor: 1         Maximum Factor
    prerequisites: N/A       Prerequisite(s)
    description: >           the Factor's own paragraph

A Factor Trait is written exactly as a Racial Trait is (see traits/races/README.txt),
`order:` as its Factor lists them. "Factor Traits are considered Racial Traits": taken
from the same Add Racial Trait list, after every race's, named "<Factor> (Factor)".
`importance: secondary` - it replaces a Secondary - unless it names a Primary Racial
Trait in brackets to replace.

Add both files to traits/index.json.
