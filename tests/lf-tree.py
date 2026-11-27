"""Copy a checkout's working tree - uncommitted changes included - with LF line endings.

core.autocrlf is on, and a worktree made by the desktop app is checked out CRLF from end to
end. Every harness that cuts a function out of a module finds its end by "\n}\n", which a
CRLF file never has: 26 harnesses died with "X is not defined" on code that was fine, and the
same run over the main checkout, which is LF, passed. So the battery reads a copy, always LF,
whatever checkout it was pointed at.

    python lf-tree.py <checkout> <into>
"""

import os, shutil, subprocess, sys

source, into = sys.argv[1], sys.argv[2]
if os.path.exists(into):
    shutil.rmtree(into)
listed = subprocess.run(["git", "-C", source, "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
                        capture_output=True, check=True).stdout.decode("utf-8").split("\0")
TEXT = (".mjs", ".js", ".hbs", ".css", ".json", ".txt", ".dbu", ".md", ".html", ".yml", ".yaml")
copied = converted = 0
for rel in filter(None, listed):
    src = os.path.join(source, rel)
    if not os.path.isfile(src):
        continue  # deleted in the working tree, not yet in a commit
    dst = os.path.join(into, rel)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    if rel.lower().endswith(TEXT):
        data = open(src, "rb").read()
        lf = data.replace(b"\r\n", b"\n")
        converted += lf != data
        open(dst, "wb").write(lf)
    else:
        shutil.copyfile(src, dst)
    copied += 1
print(f"{copied} files copied, {converted} turned CRLF to LF")
