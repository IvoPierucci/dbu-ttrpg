#!/usr/bin/env bash
# Every check, in the order that fails fastest.
#
# Syntax comes first because nothing else means anything if a file does not parse -
# and a bracket counter does not catch a stray ternary branch, which is how a broken
# chat.mjs got past three other checks.
set -u

# Run from anywhere: `bash tests/check.sh` checks this checkout; `bash tests/check.sh <other checkout>` checks another (a
# worktree). Needs bash (Git Bash on Windows), Python 3, git, and Foundry VTT installed - the harnesses run on the Node
# inside Foundry's own executable and read Foundry's own source (see tests/README.md). Where Foundry is not in its usual
# place, set FOUNDRY_NODE (the executable) and FOUNDRY_APP (its resources/app folder).
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHECKOUT="${1:-$(cd "$HERE/.." && pwd)}"

if [ -z "${FOUNDRY_NODE:-}" ]; then
  for candidate in "/c/Program Files/Foundry Virtual Tabletop/Foundry Virtual Tabletop.exe"                    "/Applications/Foundry Virtual Tabletop.app/Contents/MacOS/Foundry Virtual Tabletop"                    "/opt/foundryvtt/foundryvtt"; do
    [ -x "$candidate" ] && FOUNDRY_NODE="$candidate" && break
  done
fi
if [ -z "${FOUNDRY_APP:-}" ]; then
  for candidate in "C:/Program Files/Foundry Virtual Tabletop/resources/app"                    "/Applications/Foundry Virtual Tabletop.app/Contents/Resources/app"                    "/opt/foundryvtt/resources/app"; do
    [ -f "$candidate/package.json" ] && FOUNDRY_APP="$candidate" && break
  done
fi
if [ -z "${FOUNDRY_NODE:-}" ] || [ -z "${FOUNDRY_APP:-}" ]; then
  echo "Foundry VTT not found. Set FOUNDRY_NODE (its executable) and FOUNDRY_APP (its resources/app folder)."
  exit 2
fi
export FOUNDRY_APP
NODE=(env ELECTRON_RUN_AS_NODE=1 "$FOUNDRY_NODE")

if command -v cygpath >/dev/null 2>&1; then GUARD="file:///$(cygpath -m "$HERE/guard.mjs")"; else GUARD="file://$HERE/guard.mjs"; fi

# Read from an LF copy of its working tree, never the checkout itself: a CRLF checkout (core.autocrlf on, a worktree)
# made every harness that cuts a function out of a module die on code that was fine - see lf-tree.py. Outside this folder:
# guard.mjs refuses any .mjs in here but the harness running.
ROOT="${TMPDIR:-/tmp}/dbu-ttrpg-lf-tree"
echo "--- an LF copy of $CHECKOUT"
python "$HERE/lf-tree.py" "$CHECKOUT" "$ROOT" || exit 1

cd "$ROOT" || exit 1
failed=0

echo "--- syntax"
while IFS= read -r file; do
  if ! out=$("${NODE[@]}" --check "$file" 2>&1); then
    echo "$out"
    failed=1
  fi
done < <(find module -name '*.mjs')
[ "$failed" -eq 0 ] && echo "every module parses"

# These two print what they find and exit 0 whatever it was, so what they print is read:
# a hundred false alarms from checkjs sat here for weeks as a line nobody had to look at.
echo "--- imports, identifiers, control characters"
out=$(python "$HERE/checkjs.py" . 2>&1)
echo "$out" | grep -v "^$" | tail -6
echo "$out" | tail -1 | grep -q "^0 problem(s)$" || failed=1

echo "--- the harnesses themselves"
python "$HERE/harness-chars.py" || failed=1

echo "--- handlebars blocks"
out=$(python "$HERE/hbs.py" 2>&1)
echo "$out" | tail -6
echo "$out" | tail -1 | grep -q "^0 template problem(s)$" || failed=1

for harness in lang durations exploit arrogant recovery forbids superstacks dot kicost energy longrange absolute intervene profiletext momentcards entries profileround grapple movement power evaluate compile-traits guide racial race-traits attributes workings uses soak autohit skills compelled natural profiles signature breakdown instants area resources technique thrust blockade suddenstop reflect modifier special absorb dirtytrick feint flip holdingback insult internal liquid listing magictrick intuit powerdrain sense tailattack terrify transfiguration treatment difficulties tabs imports light terrain qualities weather environments qualities-env layout dark gear accessories apparel noeffort throw weapons render-weapon-templates buddies technique-build render-technique technique-use technique-attack technique-cards united duel elemental freeflag repair travel hunger render-adventure render-combat state-triggers worn-table minion alien animal arlian creature oni robot saibaman tuffle zooner minion-no-more minion-talents bio-android unique custom-buffs adversary relayed against change-type parry-against deal-window round-start regained oos-mode maneuver-search born-threshold header charge-options profile-tabs main-tab god-debug copy-free vehicles fusion transformations; do
  echo "--- $harness"
  # Captured rather than piped. A pipeline's status is the last command's, so `| tail -2`
  # was reporting tail's success whatever the harness did - and a harness that throws
  # never prints "N failing" at all, so a crash came out of this battery looking exactly
  # like a clean run. It did, once, and nothing said so.
  # Loaded first: no harness may load another - see guard.mjs.
  out=$("${NODE[@]}" --import "$GUARD" "$HERE/$harness.mjs" "$ROOT" 2>&1)
  status=$?
  echo "$out" | tail -2
  if [ "$status" -ne 0 ]; then
    echo "!!! $harness exited $status"
    echo "$out" | grep -E "^FAIL|Error|error" | head -4
    failed=1
  fi
  # And a harness that prints its failures yet exits 0 - those that only say "N failing" at the end.
  if [ "$status" -eq 0 ] && echo "$out" | grep -q "^FAIL"; then
    echo "!!! $harness has failing checks"
    echo "$out" | grep -E "^FAIL" | head -4
    failed=1
  fi
done

exit "$failed"
