Gear - the rulebook's Equipment.

One file per Item a character can be given, in the folder for the list it is drawn in on
the Gear tab:

  basic/     Basic Items & Accessories
  apparel/   Apparel
  weapons/   Weapons

The Add Item window offers every file for that list, and giving one copies it onto the
character as an Item they can rename and re-describe.

Headers:

  id:        the file's own name, as for every Trait
  name:      the Item's name, as printed, without its tags
  itemType:  accessory   - only in basic/, to tell an Accessory from a Basic Item.
             Every other file is what its folder is.
  tags:      tech, med, food   - the [Tech], [Med], [Food] after its name
  craftDC:   the Craft DC, as the entry writes it
  source:    Core Rule
  text: >    the entry, as printed

Every file has to be listed in traits/index.json, like every other Trait:
"gear/basic/capsule.dbu", and so on.
