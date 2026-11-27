# The verification battery

About 130 headless checks ("harnesses") plus syntax, import and template checks. **Run it before every commit; commit
only if it passes.**

```bash
bash tests/check.sh            # this checkout
bash tests/check.sh <path>     # another checkout or worktree
```

It takes about two minutes. It ends with `all passing` and exit code 0 when everything passes. Otherwise it prints `!!!`
lines naming each harness that failed, with its first `FAIL` lines.

## What it needs

- **bash** (Git Bash on Windows), **Python 3** and **git** on the PATH.
- **Foundry VTT installed.**
  - The harnesses run on the Node.js built into Foundry's own executable (`ELECTRON_RUN_AS_NODE=1`), so no separate
    Node install is needed.
  - Many of them load Foundry's own source (`resources/app`) to build real data models.
  - The script looks for Foundry in its usual place on Windows, macOS and Linux. If it is elsewhere, set two variables:

    ```bash
    FOUNDRY_NODE="/path/to/Foundry Virtual Tabletop.exe" FOUNDRY_APP="/path/to/resources/app" bash tests/check.sh
    ```

## How it works

1. **An LF copy.** `lf-tree.py` copies the checkout's working tree, uncommitted changes included, to a temporary folder
   with LF line endings. This matters because many harnesses cut a function out of a module by finding `\n}\n`, which a
   CRLF file never has.
2. **Static checks.**
   - `node --check` on every module.
   - `checkjs.py`: imports that resolve, identifiers, control characters.
   - `harness-chars.py`: the harnesses themselves.
   - `hbs.py`: every Handlebars block closed by the right helper.
3. **The harnesses** run one by one, in the order of the `for harness in ...` list in `check.sh`. Each harness is one
   `<name>.mjs`. It receives the LF copy's path as its argument and prints `ok` or `FAIL` lines. A harness that crashes,
   or prints a `FAIL`, fails the battery.

`guard.mjs` is loaded before each harness and forbids a harness from importing another. Code cut out of a module
resolves `./gear.mjs` against this folder, and loading the *gear harness* by mistake once silently cut another
harness short.

## What the harnesses check

- **Behaviour.** Many harnesses build real characters headlessly (Foundry's DataModel with the system's data models),
  apply Traits and check the resulting numbers. `compile-traits` compiles every `.dbu` file.
- **Wiring.** Others read a module's source and check that a line is there: that a Slot has its reader, that a hook is
  registered, that a pinned behaviour is still written the way it was. These **pin exact lines**. If you change a
  pinned line on purpose, keep the behaviour and update the harness in the same commit, saying why.
- **Lists.** Some pin lists: every Special Maneuver id, the non-Combat-Condition files, the published Profile texts, the
  Transformation count. When you add one of those, add it to the harness's list too. The failure message says which.

## Adding a check

- **Usually:** add a `check("what it proves", actual, expected)` to the harness of that area. `transformations.mjs`
  covers Transformations, `unique.mjs` Unique Abilities, `gear.mjs` Gear, and so on.
- **A new area:** make `<name>.mjs` by copying a small harness's opening (how it sets up `ROOT`, Foundry's source and
  the stubs), and add `<name>` to the list in `check.sh`.
- **Never import another harness.** Never read anything outside `process.argv[2]` (the checkout) and
  `process.env.FOUNDRY_APP` (Foundry).
