"""No harness may carry a control character: a `\b` written through a heredoc arrives as a
backspace, and a regex asking for a backspace matches nothing - the check passes, testing
nothing. Two did, for weeks."""
import glob, io, os, sys
here = os.path.dirname(os.path.abspath(__file__))
bad = 0
for path in sorted(glob.glob(os.path.join(here, "*.mjs")) + glob.glob(os.path.join(here, "*.py"))):
    text = io.open(path, encoding="utf-8", newline="").read()
    found = [i for i, c in enumerate(text) if ord(c) < 32 and c not in "\n\r\t"]
    if found:
        bad += 1
        line = text.count("\n", 0, found[0]) + 1
        print(f"FAIL  {os.path.basename(path)}: {len(found)} control character(s), first on line {line}")
print("no control characters in the harnesses" if not bad else f"{bad} harness(es) with control characters")
sys.exit(1 if bad else 0)
