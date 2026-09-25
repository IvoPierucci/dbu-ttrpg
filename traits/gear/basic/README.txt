Basic Items & Accessories. A file here is a Basic Item unless its header says
`itemType: accessory`. See ../README.txt.

Accessories are worn: "You can only equip up to 2 Accessories at once. You can spend 1
Action to equip or remove an Accessory. You cannot wear two of the same Accessory, nor
benefit from the same Accessory's effects twice (even if it was Integrated)." An
Accessory's row has Equip / Unequip, which spends the Action and refuses a third, or a
second of the same file. Its effects apply only while it is worn - whatever reads them
reads accessoriesInEffect() in module/gear.mjs, one of each.

Not built yet: Integrated, which arrives with the rules that name it.
