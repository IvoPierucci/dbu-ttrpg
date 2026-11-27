"""Keep traits/index.json in step with the .dbu files on disk.

    python tools/reindex.py           compare, and say what differs
    python tools/reindex.py --write   rewrite the list: files on disk and not listed are appended, listed ones gone are dropped

Foundry cannot list a folder from the browser, so every Trait file has to be named in traits/index.json. The list keeps the
order files were added in; new ones go at the end. After a merge conflict in index.json, take either side and run --write.
"""
import json
import os
import sys

ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "traits")
path = os.path.join(ROOT, "index.json")
data = json.load(open(path, encoding="utf-8"))
disk = sorted(os.path.relpath(os.path.join(folder, name), ROOT).replace(os.sep, "/")
              for folder, _, names in os.walk(ROOT) for name in names if name.endswith(".dbu"))
listed = data["traits"]
missing = sorted(set(disk) - set(listed))
gone = sorted(set(listed) - set(disk))
print(f"listed {len(listed)}, on disk {len(disk)}")
print("on disk, not listed:", missing or "none")
print("listed, not on disk:", gone or "none")
if "--write" in sys.argv:
    have = set(disk)
    data["traits"] = [entry for entry in listed if entry in have] + missing
    raw = open(path, encoding="utf-8").read()
    newline = "\r\n" if "\r\n" in raw else "\n"
    with open(path, "w", encoding="utf-8", newline="") as out:
        out.write(json.dumps(data, indent=2, ensure_ascii=False).replace("\n", newline) + newline)
    print("written")
elif missing or gone:
    sys.exit(1)
