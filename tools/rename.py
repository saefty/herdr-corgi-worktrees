#!/usr/bin/env python3
"""Renames the mod, run from the repo root with a clean tree: python3 tools/rename.py <new-name> ["New Title"]

"worktrees" is a working name. The name is the folder under mods/, the prefix of the shared keys, the settings
file and the commands, so it shows up in code (mods/<name>/name.js only), the manifests, the demo and the docs.
This moves the folder and rewrites every tracked text file; the word "worktrees" for git's worktrees stays
(only the name's own forms are replaced). Afterwards: python3 .github/scripts/check.py, and rename the repo
folder yourself.
"""
import re
import subprocess
import sys

OLD, OLD_TITLE = "worktrees", "Worktrees"


def patterns(old, new):
    """The forms the name takes, most specific first: (regex, replacement)."""
    q = re.escape(old)
    return [
        (rf"\bmods/{q}\b", f"mods/{new}"),                                    # paths
        (rf"\bherdr-corgi-{q}\b", f"herdr-corgi-{new}"),                      # the repo
        (rf"\bherdr-{q}-demo\b", f"herdr-{new}-demo"),                        # the demo core's socket folder
        (rf"\b{q}-(demo|api)\b", rf"{new}-\1"),                               # the demo mod, corgi.json provides
        (rf"\b{q}\.(api|count|providers|prs|demo|config\.json)\b", rf"{new}.\1"),  # shared keys, the settings file
        (rf"\b{q}\.(\$1|h-|refresh|show|expand|open|pr|history|older|more|family|<command>)", rf"{new}.\1"),  # commands
        (rf"data/{q}/", f"data/{new}/"),                                      # the mod's stored state
        (rf'"{q}"', f'"{new}"'),                                              # JSON and JS string literals
        (rf"`{q}`", f"`{new}`"),                                              # the name in prose
        (rf"\b(enable|disable|update|dev|save|release) {q}\b", rf"\1 {new}"), # corgi commands
    ]


def main():
    if len(sys.argv) not in (2, 3) or not re.fullmatch(r"[a-z][a-z0-9-]*", sys.argv[1]):
        sys.exit(__doc__)
    new, title = sys.argv[1], (sys.argv[2] if len(sys.argv) == 3 else sys.argv[1].capitalize())
    if subprocess.run(["git", "status", "--porcelain"], capture_output=True, text=True, check=True).stdout.strip():
        sys.exit("commit or stash your changes first")
    subprocess.run(["git", "mv", f"mods/{OLD}", f"mods/{new}"], check=True)
    subprocess.run(["git", "mv", f"demo/fixtures/{OLD}-demo", f"demo/fixtures/{new}-demo"], check=True)
    files = subprocess.run(["git", "ls-files", "-z"], capture_output=True, text=True, check=True).stdout.split("\0")
    changed = 0
    for f in filter(None, files):
        if f == "tools/rename.py":
            continue
        try:
            with open(f, encoding="utf-8") as fh:
                text = fh.read()
        except (UnicodeDecodeError, OSError):
            continue  # binary
        out = text
        for rx, to in patterns(OLD, new):
            out = re.sub(rx, to, out)
        out = re.sub(rf'TITLE = "{OLD_TITLE}"', f'TITLE = "{title}"', out)
        out = re.sub(rf'"title": "{OLD_TITLE}"', f'"title": "{title}"', out)
        out = re.sub(rf"\bCorgi · {OLD_TITLE}\b", f"Corgi · {title}", out)
        if out != text:
            with open(f, "w", encoding="utf-8") as fh:
                fh.write(out)
            changed += 1
    print(f"renamed to {new} ({title}): {changed} files rewritten. Check the prose for the title, then run check.py.")


if __name__ == "__main__":
    main()
