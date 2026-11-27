# Working on this repository (read this first)

This file is for any AI assistant (Claude Code or similar) and any person working on the DBU TTRPG Foundry system.
**More than one person works on this repository, each with their own Claude.** Neither Claude can see the other's
conversation or private memory. **Everything one needs to know must be written in the repository.** Use this file, the
documents in `docs/` and the commit messages for that.

Replies to the project owners are usually in Spanish. Code, comments, documentation and commit messages are in English.

## What this is

An unofficial Foundry VTT (v13-v14) game system for the Dragon Ball Universe tabletop RPG (dbu-rpg.com). There is no
build step: Foundry loads `module/dbu-ttrpg.mjs` and the `.mjs` files it imports directly. Most game content (2,000+
Traits, Talents, Maneuvers, Transformations, Gear...) is data in `traits/**/*.dbu`, written in a small effects language.

## Where to start reading

| You want to... | Read |
|---|---|
| Understand how the code is organised | [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) |
| Add or fix a Trait, Talent, Maneuver, Transformation... | [`docs/ADDING-CONTENT.md`](docs/ADDING-CONTENT.md), then [`WRITING-EFFECTS.txt`](WRITING-EFFECTS.txt) |
| Know how the owners read an ambiguous rule | [`docs/RULINGS.md`](docs/RULINGS.md) - **check it before asking or deciding** |
| See what is being worked on, what is left, what is waiting | [`docs/WORKLOG.md`](docs/WORKLOG.md) |
| See what changed per version | [`CHANGELOG.md`](CHANGELOG.md) |

## Coordination between contributors

- **Pull before you start, and before you push.** Commit small, self-contained steps rather than one large commit at the end.
  This keeps two people's work from colliding in the big files (`module/chat.mjs`, `module/use-maneuver.mjs`, `traits/index.json`).
- **Write down what the other side needs to know.**
  - A ruling the owner gave you goes in [`docs/RULINGS.md`](docs/RULINGS.md).
  - Work you leave unfinished, and anything waiting on a rules text, goes in the open items of [`docs/WORKLOG.md`](docs/WORKLOG.md).
  - Anything notable you finished goes in its log.
- **Don't redo or undo the other's work silently.** If something looks wrong in recent commits by someone else, say so to
  the owner rather than reverting it.
- **`traits/index.json` conflicts:** resolve them by re-running `python tools/reindex.py --write`. Don't merge the file by hand.

## Rules for changing anything

1. **Rules texts come from the owners.** Copy them verbatim into the file's `text:`. Don't read rules from dbu-rpg.com on
   your own initiative; use a page only when an owner gives you its link. Don't invent wording.
2. **Never bump the version or push unless an owner asks.**
   - "Subí de versión" means: bump the patch number in `system.json`, then commit `Bump to X.Y.Z` on its own.
   - "Pusheá" means push. "Aplicalo al foundry" means bump and push.
3. **Requirements and limits are warned about, never refused.** Applies to Race, Tier of Power, Prerequisites, slot limits and
   the Awakening Limit: the sheet shows the warning and lets the table decide.
4. **`module/` and `templates/` never name a specific Transformation** (by id or name). If a Transformation needs new
   machinery, add it generically: a Slot, verb, predicate, Moment or header named for what it does. Its folder then uses it.
   The same spirit applies to all content: prefer a reusable piece over code keyed to one Trait.
5. **[Triggered] means the player chooses.** Build it as a button or a tick in a window, never applied automatically.
   [Passive] is what applies by itself. More of these conventions are in [`docs/RULINGS.md`](docs/RULINGS.md).
6. **No extra chat cards.** Offers go on the card that already exists (the turn card, the Round card, the attack card,
   the Transformation card), never a new message.
7. **Say what is left undone.** If you can't automate part of an effect, write it in the file's comments as
   "the table's", with the reason. Tell the owner which calls were your own reading of the rule.
8. **Don't break what others rely on.** Many harnesses pin exact lines of code (see Verification). If you change such a
   line, keep the behaviour, update the harness in the same commit, and say why.

## Verification

- **Run `bash tests/check.sh` before every commit, and commit only if it passes.** Chain the commit on its exit status
  (`if bash tests/check.sh > battery.log 2>&1; then git commit ...; fi`); never run both unconditionally. See
  [`tests/README.md`](tests/README.md). It needs Foundry VTT installed; it finds it in the usual place or through
  `FOUNDRY_NODE` / `FOUNDRY_APP`.
- **The battery is about 130 harnesses.** They compile every Trait, build characters headlessly and check numbers, and
  pin key lines of code. A harness failing after your change is telling you something; read its `FAIL` line before
  touching the harness.
- **Add checks for what you build,** in the harness of that area, so the next person's change can't silently undo it.
- **Then try it in Foundry** on a test actor. Say in your report what you tested there and what you didn't.
- Every Trait file is compiled when Foundry loads. A file that fails to compile is skipped and named in the console
  (F12), and the rest keep working.

## Commits

- One logical change per commit. The first line names what changed, in the game's own terms. For example:
  `Boiling Rage (the owner's link, 2026-11-26): an Enhancement, Variant of Enraged ...`.
- The body says why. It also says which parts are your own reading and what is left to the table.
- `main` is the working branch. Commit only when the change works; never commit a known-broken state.
- Don't commit `battery.log` (git ignores it), editor folders, or `packs/*/` (LevelDB files Foundry builds itself).

## Gotchas that cost time before

- **Foundry `ObjectField` traps.** A shared `initial: {}` leaks data between actors. Removing keys does not persist
  without a forced replacement. A `SchemaField` silently drops undeclared keys. Prefer `SchemaField`/`ArrayField`.
- **A new effect question must be registered.** Add it to `module/effects/parser.mjs` (`PREDICATE_NAMES` or
  `BARE_PREDICATES`) as well as `module/effects/conditions.mjs`. Otherwise it silently never applies.
- **"X does nothing" is usually a Slot nobody reads.** The script writes it correctly and no code consumes it. Find the reader
  before blaming the script.
- **Foundry combat hooks run on the clicking client.** `combatRound`/`combatStart` run before the write. GM-only work
  belongs in `combatTurnChange` on the GM's client.
- **Line endings.** Git's `autocrlf` is on here. A stash pop can turn the working tree to CRLF; compare with `git show`.
