"""Static checks for the DBU system, standing in for a test runner.

Two things, both of which have caught real bugs here:
  imports  - every relative import resolves, and names a real export
  idents   - every identifier used is declared, imported, or a known global

The identifier pass is the one that matters: replacing a piece and leaving a
dangling reference behind is the bug shape this project keeps hitting, and a
brace check never sees it.
"""

import io, os, re, sys

ROOT = sys.argv[1] if len(sys.argv) > 1 else "."

# --- Comment and string stripping ------------------------------------------

def strip(src):
    """Blank out comments, strings and regex literals, keeping offsets.

    A template literal's text is blanked and its holes are read as code - recursively,
    since a hole can hold a template of its own (`${list.map(x => `<li>${x}</li>`)}`),
    and with its own braces counted, so the `}` of an arrow's body or an object literal
    in a hole is not taken for the hole's end. The first version counted only `${` and
    `}`: the first `{ ... }` in a hole closed it early, everything after was read inside
    out, and three files came out with a hundred false alarms - while the code in the
    holes, which its comment said was kept, was blanked with the text and never checked.
    """
    out = []
    n = len(src)

    def blank(text):
        out.append("".join(ch if ch == "\n" else " " for ch in text))

    def code(i, hole):
        """Code from i: to the end, or - in a template hole - to the `}` closing it."""
        prev = "(" if hole else ""  # last significant char, to tell regex from division
        depth = 0
        while i < n:
            c = src[i]
            two = src[i:i + 2]
            if two == "//":
                j = src.find("\n", i)
                j = n if j < 0 else j
                blank(src[i:j]); i = j; continue
            if two == "/*":
                j = src.find("*/", i + 2)
                j = n if j < 0 else j + 2
                blank(src[i:j]); i = j; continue
            if c in "\"'":
                j = i + 1
                while j < n and src[j] != c and src[j] != "\n":
                    j += 2 if src[j] == "\\" else 1
                j = min(j + 1, n)
                blank(src[i:j]); i = j; prev = "x"; continue
            if c == "`":
                i = template(i); prev = "x"; continue
            if c == "/" and prev in "(,=:[!&|?{};+-*%~^<>":
                j = i + 1
                ok = False
                klass = False  # a / inside [...] does not end a regex: /[^/]+/
                while j < n:
                    if src[j] == "\\": j += 2; continue
                    if src[j] == "\n": break
                    if src[j] == "[": klass = True
                    elif src[j] == "]": klass = False
                    elif src[j] == "/" and not klass: ok = True; break
                    j += 1
                if ok:
                    j += 1
                    while j < n and src[j].isalpha(): j += 1
                    blank(src[i:j]); i = j; prev = "x"; continue
            if hole:
                if c == "{":
                    depth += 1
                elif c == "}":
                    if depth == 0:
                        return i
                    depth -= 1
            out.append(c)
            if not c.isspace(): prev = c
            i += 1
        return i

    def template(i):
        """From the opening backtick at i, to just past its closing one."""
        out.append(" ")
        j = i + 1
        while j < n:
            if src[j] == "\\":
                blank(src[j:j + 2]); j += 2; continue
            if src[j:j + 2] == "${":
                out.append("  ")
                j = code(j + 2, True)
                if j < n:
                    out.append(" "); j += 1
                continue
            if src[j] == "`":
                out.append(" ")
                return j + 1
            blank(src[j]); j += 1
        return j

    code(0, False)
    result = "".join(out)
    assert len(result) == n, "strip must keep every offset"
    return result


def files():
    for base, _, names in os.walk(os.path.join(ROOT, "module")):
        for name in names:
            if name.endswith(".mjs"):
                yield os.path.join(base, name)


SOURCES = {}
RAW = {}
for path in files():
    text = io.open(path, encoding="utf-8").read()
    key = os.path.normpath(path)
    RAW[key] = text
    SOURCES[key] = strip(text)

# --- Exports ---------------------------------------------------------------

def exports_of(src):
    names = set()
    for m in re.finditer(r'\bexport\s+(?:async\s+)?(?:function|class)\s+(\w+)', src):
        names.add(m.group(1))
    for m in re.finditer(r'\bexport\s+(?:const|let|var)\s+(\w+)', src):
        names.add(m.group(1))
    for m in re.finditer(r'\bexport\s*\{([^}]*)\}', src):
        for part in m.group(1).split(","):
            part = part.strip()
            if not part: continue
            names.add(part.split()[-1])
    if re.search(r'\bexport\s+default\b', src):
        names.add("default")
    return names

problems = []

# --- Import resolution -----------------------------------------------------

IMPORT = re.compile(r'\bimport\s+([^;]*?)\s+from\s+["\']([^"\']+)["\']', re.S)

def parse_clause(clause):
    named, default = set(), None
    star = re.search(r'\*\s*as\s+([A-Za-z_$][\w$]*)', clause)
    if star:
        # A namespace import binds one name and makes no claim about any export.
        return named, None, star.group(1)
    m = re.search(r'\{([^}]*)\}', clause)
    if m:
        for part in m.group(1).split(","):
            part = part.strip()
            if not part: continue
            bits = part.split()
            named.add((bits[0], bits[-1]))
        clause = clause[:m.start()] + clause[m.end():]
    rest = clause.replace(",", " ").split()
    if rest: default = rest[0]
    return named, default, None

BINDINGS = {}

for path, src in SOURCES.items():
    local = set()
    for m in IMPORT.finditer(RAW[path]):
        clause, spec = m.group(1), m.group(2)
        named, default, star = parse_clause(clause)
        for _, alias in named: local.add(alias)
        if default: local.add(default)
        if star:
            local.add(star)
            continue
        if not spec.startswith("."): continue
        target = os.path.normpath(os.path.join(os.path.dirname(path), spec))
        if target not in SOURCES:
            problems.append(f"{path}: imports {spec}, which does not exist")
            continue
        available = exports_of(SOURCES[target])
        for name, _ in named:
            if name not in available:
                problems.append(f"{path}: {spec} does not export {name}")
        if default and "default" not in available:
            problems.append(f"{path}: {spec} has no default export")
    BINDINGS[path] = local

# --- Undeclared identifiers ------------------------------------------------

GLOBALS = set("""
game ui Hooks CONFIG canvas foundry PIXI Roll ChatMessage Actor Item Macro Combat Dialog
Handlebars fromUuid fromUuidSync loadTemplates renderTemplate Actors Items console
window document CSS Math JSON Object Array String Number Boolean Set Map Promise Error
Date RegExp Infinity NaN undefined null true false this arguments Symbol parseInt
parseFloat isNaN setTimeout clearTimeout requestAnimationFrame Intl Proxy Reflect
BigInt WeakMap WeakSet ArrayBuffer Uint8Array TextEncoder TextDecoder URL Blob
FormData fetch FilePicker DragDrop TextEditor Token TokenDocument Scene User Folder
CompendiumCollection Collection HTMLElement Event CustomEvent AbortController
localStorage structuredClone globalThis process Intl encodeURIComponent
decodeURIComponent
""".split())

KEYWORDS = set("""
break case catch class const continue debugger default delete do else export extends
finally for function if import in instanceof let new return static super switch throw
try typeof var void while with yield async await of get set as from
""".split())

PARAMS = r'\((( ?:[^()]|\([^()]*\))*)\)'.replace(' ', '')

DECL = [
    re.compile(r'\b(?:const|let|var)\s+(\w+)'),
    re.compile(r'\b(?:async\s+)?function\s*\*?\s*(\w+)'),
    re.compile(r'\bclass\s+(\w+)'),
    re.compile(r'\bcatch\s*\(\s*(\w+)'),
]

def declared_in(src):
    names = set()
    for pattern in DECL:
        for m in pattern.finditer(src):
            names.add(m.group(1))
    # Destructuring and parameter lists: every bare word inside () or {} that is
    # bound rather than read. Approximated generously to avoid false alarms.
    for m in re.finditer(r'\b(?:const|let|var)\s*[\{\[]([^\}\]]*)[\}\]]', src):
        for w in re.findall(r'\b([A-Za-z_$][\w$]*)\b', m.group(1)):
            names.add(w)
    for m in re.finditer(PARAMS + r'\s*=>', src):
        for w in re.findall(r'\b([A-Za-z_$][\w$]*)\b', m.group(1)):
            names.add(w)
    for m in re.finditer(r'\b([A-Za-z_$][\w$]*)\s*=>', src):
        names.add(m.group(1))
    for m in re.finditer(r'\b(?:async\s+)?function\s*\*?\s*\w*\s*' + PARAMS, src):
        for w in re.findall(r'\b([A-Za-z_$][\w$]*)\b', m.group(1)):
            names.add(w)
    # Method shorthand and class methods take parameters too.
    #
    # Not `if (...) {`, and not any of its relatives. This pattern read a control-flow
    # keyword as a method name and everything in its condition as a parameter list, so
    # every identifier used inside an `if`, a `while`, a `for`, a `switch` or a `catch`
    # counted as declared. That is most of the identifier uses in this codebase, and it
    # is why a name used and never imported went through this check unremarked.
    for m in re.finditer(r'\b([A-Za-z_$][\w$]*)\s*' + PARAMS + r'\s*\{', src):
        if m.group(1) in KEYWORDS: continue
        names.add(m.group(1))
        for w in re.findall(r'\b([A-Za-z_$][\w$]*)\b', m.group(2)):
            names.add(w)
    return names

# A leading # is a private class field, which is declared by the class rather
# than by any of the declaration patterns above.
USE = re.compile(r'(?<![\.\w$#])([A-Za-z_$][\w$]*)\s*(?=[\(\.\[])')

for path, src in SOURCES.items():
    known = declared_in(src) | BINDINGS.get(path, set()) | GLOBALS | KEYWORDS
    # Property keys in object literals look like uses; drop `name:` forms.
    seen = set()
    for m in USE.finditer(src):
        word = m.group(1)
        if word in known or word in seen: continue
        line = src.count("\n", 0, m.start()) + 1
        seen.add(word)
        problems.append(f"{path}:{line}: {word} is used but never declared or imported")

# --- Undeclared identifiers, per method ------------------------------------
#
# The pass above knows one scope per file: a name declared anywhere in the file
# counts as declared everywhere in it. Which is how `system` went through it -
# it is a parameter of four module-level functions in the character sheet, and
# that made it look declared inside a class method five hundred lines away that
# had never bound it. The sheet threw `system is not defined` the first time
# anybody opened it, and this check had said nothing.
#
# So: class method bodies get a scope of their own. What is visible inside one is
# the module's own top-level names, plus whatever the method binds anywhere within
# itself. Nested arrows inside the method are folded into it rather than given
# scopes of their own - that over-counts what an inner name is visible to, and
# over-counting is the safe direction for a check that must not cry wolf.
#
# Module scope is read narrowly on purpose: the *names* declared at the top level,
# never the parameters of the functions declared there. Taking those in is exactly
# the mistake that made the file-wide pass blind.

# `export default class Foo` is a top-level name too, and leaving `default` out of
# these was eighteen false alarms - every class in this codebase is exported that way.
EXPORTED = r'^(?:export\s+)?(?:default\s+)?'

TOP = [
    re.compile(EXPORTED + r'(?:async\s+)?function\s*\*?\s*(\w+)', re.M),
    re.compile(EXPORTED + r'(?:const|let|var)\s+(\w+)', re.M),
    re.compile(EXPORTED + r'class\s+(\w+)', re.M),
]
TOP_DESTRUCTURED = re.compile(EXPORTED + r'(?:const|let|var)\s*[\{\[]([^\}\]]*)[\}\]]', re.M)

# A class method: indented, optionally static/async/a getter, a name, a parameter
# list, then the body. Deliberately anchored to two spaces of indent, which is
# what a method has in this codebase and a nested function never does.
METHOD = re.compile(
    r'^  (?:static\s+)?(?:async\s+)?(?:get\s+|set\s+)?(#?[A-Za-z_$][\w$]*)\s*'
    + PARAMS + r'\s*\{', re.M)


def body_of(src, opens):
    """From the { at `opens`, the offset just past its matching }."""
    depth = 0
    for at in range(opens, len(src)):
        if src[at] == "{":
            depth += 1
        elif src[at] == "}":
            depth -= 1
            if depth == 0:
                return at
    return len(src)


for path, src in SOURCES.items():
    if " class " not in " " + src.replace("\n", " "):
        continue

    module_scope = set()
    for pattern in TOP:
        module_scope |= {m.group(1) for m in pattern.finditer(src)}
    for m in TOP_DESTRUCTURED.finditer(src):
        module_scope |= set(re.findall(r'\b([A-Za-z_$][\w$]*)\b', m.group(1)))

    outer = module_scope | BINDINGS.get(path, set()) | GLOBALS | KEYWORDS

    for m in METHOD.finditer(src):
        if m.group(1) in KEYWORDS:
            continue
        opens = src.index("{", m.end() - 1)
        ends = body_of(src, opens)
        body = src[opens:ends]

        known = outer | declared_in(body)
        known |= set(re.findall(r'\b([A-Za-z_$][\w$]*)\b', m.group(2)))

        seen = set()
        for use in USE.finditer(body):
            word = use.group(1)
            if word in known or word in seen:
                continue
            seen.add(word)
            line = src.count("\n", 0, opens + use.start()) + 1
            problems.append(
                f"{path}:{line}: {word} is used in {m.group(1)}() but bound nowhere "
                f"it can see - the file declares it somewhere else")

# --- Stray control characters ----------------------------------------------
# A backspace once ended up inside a regex, where it read as an ordinary character
# and made the pattern silently unmatchable. Nobody types one of these on purpose;
# they arrive when an escape sequence gets collapsed one time too many on the way
# into the file.
import glob

for base, dirs, names in os.walk(ROOT):
    if ".git" in base.replace(chr(92), "/").split("/"): continue
    for name in names:
        if not name.endswith((".mjs", ".hbs", ".css", ".json", ".txt", ".dbu")): continue
        full = os.path.join(base, name)
        try:
            text = io.open(full, encoding="utf-8").read()
        except Exception:
            continue
        for i, ch in enumerate(text):
            if (ord(ch) < 32) and (ch not in "\n\r\t"):
                line = text.count("\n", 0, i) + 1
                problems.append(
                    f"{full}:{line}: stray control character U+{ord(ch):04X} "
                    f"- an escape was collapsed here")

for p in sorted(problems):
    print(p)
print(f"\n{len(problems)} problem(s)")
