# Races

One JSON file per race. To add a race:

1. Drop a new `.json` file in this folder.
2. Add its filename to the `races` array in `index.json`.
3. Reload Foundry.

The list lives in `index.json` because a browser cannot read the contents of a
directory - it can only fetch files it is told about by name.

## File format

```json
{
  "id": "saiyan",
  "name": "Saiyan",
  "lifeModifier": 3,
  "attributeIncrease": { "force": 2, "tenacity": 2, "agility": 1 },
  "savingThrow": "corporeal",
  "skillRanks": 2,
  "description": "Shown as a tooltip on the race selector."
}
```

| Field | Required | Meaning |
|---|---|---|
| `id` | yes | Unique key. This is what gets stored on the actor, so changing it later orphans existing characters. |
| `name` | yes | Shown in the race dropdown. |
| `lifeModifier` | yes | Racial Life Modifier (RLM), added to Maximum Life Points once per Power Level. |
| `attributeIncrease` | no | Attribute Score increases that are fixed for the race. |
| `attributeChoices` | no | Increases the player picks. See below. |
| `exclusiveAttributes` | no | Groups of Attributes from which at most one may be picked across all choices. |
| `savingThrow` | no | The race's focused Saving Throw, or a list of them. It gains +1(bT) and its Critical Target drops by 1. |
| `skillRanks` | no | How many Skill Ranks the race grants. Picked in the Progression tab, counted toward the Tier of Power rank cap, and treated as earned at Power Level 1. |
| `description` | no | Free text, shown as a tooltip. |

Attribute keys: `agility`, `force`, `tenacity`, `scholarship`, `insight`, `magic`,
`personality`. Saving Throw keys: `impulsive`, `corporeal`, `cognitive`, `morale`.

Every published race grants +2 to two Attributes and +1 to a third, whether fixed,
chosen, or a mix of both.

## Player-chosen increases

`attributeChoices` is a list of `{ "amount", "options" }`. `options` is either a list
of Attribute keys or the string `"any"` for a free pick. Each choice becomes a
dropdown in the Progression tab, and no two choices may land on the same Attribute.

```json
"attributeIncrease": { "insight": 2 },
"attributeChoices": [
  { "amount": 2, "options": ["agility", "tenacity"] },
  { "amount": 1, "options": ["scholarship", "personality"] }
]
```

`exclusiveAttributes` adds a further restriction - the Bio Android may pick freely,
but never both Force and Magic:

```json
"attributeChoices": [
  { "amount": 2, "options": "any" },
  { "amount": 2, "options": "any" },
  { "amount": 1, "options": "any" }
],
"exclusiveAttributes": [["force", "magic"]]
```

## Two Saving Throws

A race that focuses two Saving Throws lists both; each one gets the full bonus.

```json
"savingThrow": ["cognitive", "impulsive"]
```
