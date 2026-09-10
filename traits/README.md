# Traits

One file per Trait. To add one, copy a file next to it and edit it - that is the
whole procedure. **`WRITING-EFFECTS.txt`, in the system's root folder, explains the
language.**

## The folders

The folder a file sits in says two things at once: what the Trait attaches to, and
where it sits on the rulebook's Priority ladder. Those turn out to be the same
ordering, which is why the tree looks like the ladder.

```
traits/
  aspects/                 shared by whichever Transformations declare them
  states/                  the six States, whose effects scale with their level
  transformations/<form>/
  races/<race>/            that race's Traits, chosen from as a catalogue
  talents/                 standalone, chosen in Progression
  conditions/              Combat Conditions
  maneuvers/
  karma/                   the Karmic Effects, bought with a Karma Point
```

`aspects/` is the exception, deliberately: an Aspect belongs to nobody. It is a
shared piece that Transformations pick up, each with its own level, so it is
referenced from the other side rather than filed under an owner.

## The file

A header of `key: value` lines, a `---` on its own, then the script.

```
id: resilience
name: Resilience
prerequisites: Tenacity Score 6+
description: >
  Able to bounce back from damage more easily than most.
text: >
  Increase your Soak Value by 1(bT).
  Increase the Life Points regained through a Healing Surge by 1d10(T).

---

[passive]
soakValue       += 1(bT);
surge.life.dice += 1d10(T);
```

`>` starts a block of text that runs for as long as the lines stay indented.

| Field | Meaning |
|---|---|
| `id` | Unique key. Stored on anything that refers to this Trait, so changing it later orphans them. Defaults to the filename. |
| `name` | What it is called. |
| `text` | The rulebook's own wording, shown to players. Keep it: a script is exact but does not read like a rule. |
| `description` | Flavour. |
| `prerequisites` | What is needed to take it. |
| `addendum` | The separate explanation an `Addendum` effect carries. |
| `maxStacks` | For a Combat Condition marked `[S]`. |
| `levels` | For a State or Aspect that has them. |
| `resource` / `resourceMax` | If it grants a Resource. Leave the max out for no ceiling. |
| `aspects` | For a Transformation: which Aspects it has. |

## index.json

Every file has to be named there. This is not busywork that could be automated
away - a browser cannot list a directory, and the one Foundry API that can needs a
permission ordinary players do not have. The index is generated when the system is
released, so nobody maintains it by hand.
