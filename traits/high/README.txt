HIGH BATTLE ENVIRONMENTS
========================

One file per rank of High Environment. They are Battle Environments in every way that
matters and they sit in a folder of their own for the reason the Environmental
Qualities do: traits/battlefields/ is already searched four times over and each search
has to say which files are its own.

    kind: high        (the folder says it)
    highRank: 1..4    which rank this is, and what a rule comparing ranks reads

"For effects that refer to higher and/or lower ranks of High Environment, the typical
Battle Environment that is not a High Environment is considered Rank 0." So there is no
file for the ground: Rank 0 is the absence of one of these.

Headers these carry that a Battle Environment does not:

    noWeather: true        "Battle Weather cannot exist in this Battle Environment."
    grantsKnockback: true  every Attacking Maneuver has the Knockback Advantage here
    knockbackMight: 1      what an attack that already had Knockback gains, in (bT)

And one they deliberately do not: `hardnessMin` / `hardnessMax`. "Hardness Rank: N/A" -
there is no ground up here, which is what Lacking Collision is about.
