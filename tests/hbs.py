"""Check that every Handlebars block is closed, and closed by the right helper."""
import io, os, re

bad = 0
for base, _, names in os.walk("templates"):
    for name in sorted(names):
        if not name.endswith(".hbs"):
            continue
        path = os.path.join(base, name)
        text = io.open(path, encoding="utf-8").read()
        stack = []
        for m in re.finditer(r"\{\{([#/])([A-Za-z_][\w.-]*)", text):
            kind, helper = m.group(1), m.group(2)
            line = text.count("\n", 0, m.start()) + 1
            if kind == "#":
                stack.append((helper, line))
            elif not stack or stack[-1][0] != helper:
                opened = stack[-1] if stack else ("nothing", 0)
                print(f"{path}:{line}: closes {helper}, but {opened[0]} is open")
                bad += 1
                if stack:
                    stack.pop()
            else:
                stack.pop()
        for helper, line in stack:
            print(f"{path}:{line}: {helper} is never closed")
            bad += 1

print(f"{bad} template problem(s)")
