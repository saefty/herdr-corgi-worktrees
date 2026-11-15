"""Run: python3 test_probe.py   (builds throwaway repos in a temp folder; needs git)"""
import json
import os
import subprocess
import sys
import tempfile
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import probe  # noqa: E402

ENV = {**os.environ, "GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_SYSTEM": os.devnull,
       "GIT_AUTHOR_NAME": "Demo", "GIT_AUTHOR_EMAIL": "noreply@example.com", "GIT_COMMITTER_NAME": "Demo", "GIT_COMMITTER_EMAIL": "noreply@example.com"}


def git(cwd, *args):
    return subprocess.run(["git", *args], cwd=cwd, env=ENV, check=True, capture_output=True, text=True).stdout.strip()


def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        f.write(text)
    time.sleep(0.01)  # file times have to move between two changes


def look(path, gitdir=None, common=None):
    return probe.probe(path, gitdir or f"{path}/.git", common or f"{path}/.git", {})


def main():
    with tempfile.TemporaryDirectory() as tmp:
        tmp = os.path.realpath(tmp)
        repo, bare = f"{tmp}/repo", f"{tmp}/remote.git"
        git(tmp, "init", "-q", "-b", "main", repo)
        write(f"{repo}/README.md", "hello\n")
        write(f"{repo}/src/app/main.js", "one\n")
        write(f"{repo}/.gitignore", "*.log\nbuild/\n")
        git(repo, "add", "-A")
        git(repo, "commit", "-qm", "chore: start")
        git(tmp, "init", "-q", "--bare", "-b", "main", bare)
        git(repo, "remote", "add", "origin", bare)
        git(repo, "push", "-qu", "origin", "main")

        a = look(repo)
        assert a["branch"] == "main" and a["oid"] == git(repo, "rev-parse", "HEAD"), a
        assert a["upstream"] == "origin/main" and a["upOid"] == a["oid"] and a["onRemote"] is True, a
        assert a["stash"] == 0 and a["fp"] and a["t"]["files"] is None and a["t"]["index"] and a["t"]["head"], a
        assert look(repo)["fp"] == a["fp"]                       # nothing happened: the same fingerprint
        time.sleep(1.1); os.utime(f"{repo}/README.md"); git(repo, "status")   # a touched file: git status refreshes the index file
        assert look(repo)["fp"].split("|")[2] == a["fp"].split("|")[2], "an index refresh is not a change of what is staged"
        steady = look(repo)["fp"]

        def changes(what, expect=True):
            nonlocal steady
            now = look(repo)
            assert (now["fp"] != steady) == expect, f"{what}: fingerprint {'did not change' if expect else 'changed'}"
            steady = now["fp"]
            return now

        write(f"{repo}/src/app/main.js", "one\ntwo\n")
        b = changes("a tracked file edited")
        assert b["t"]["files"] and abs(b["t"]["files"] - time.time() * 1000) < 60_000, b   # the newest changed tracked file
        write(f"{repo}/notes.txt", "x")
        changes("an untracked file in the root")
        write(f"{repo}/src/app/new.js", "x")
        changes("an untracked file in a tracked folder")
        os.makedirs(f"{repo}/scratch")
        changes("a new folder")
        write(f"{repo}/scratch/idea.txt", "x")
        changes("a file in an untracked folder right below a tracked one")
        write(f"{repo}/scratch/more.txt", "x")
        changes("one more file there")
        os.remove(f"{repo}/src/app/new.js")
        changes("an untracked file removed")
        git(repo, "add", "src/app/main.js")
        changes("staged")
        git(repo, "commit", "-qm", "feat: two")
        c = changes("committed")
        assert c["oid"] != c["upOid"] and c["onRemote"] is False and c["t"]["files"] is None, c
        git(repo, "push", "-q")
        d = changes("pushed")
        assert d["oid"] == d["upOid"] and d["onRemote"] is True, d
        write(f"{repo}/README.md", "hello again\n")
        changes("edited again")
        git(repo, "stash", "-q")
        e = changes("stashed")
        assert e["stash"] == 1, e
        os.remove(f"{repo}/README.md")
        changes("a tracked file deleted")
        git(repo, "checkout", "-q", "--", "README.md")
        changes("restored")
        changes("nothing", expect=False)

        # a branch without upstream, a detached HEAD
        git(repo, "checkout", "-qb", "feat/x")
        f = look(repo)
        assert f["branch"] == "feat/x" and f["upstream"] is None and f["upOid"] is None and f["onRemote"] is True, f   # still on a pushed commit
        git(repo, "commit", "-q", "--allow-empty", "-m", "feat: x")
        assert look(repo)["onRemote"] is False
        git(repo, "checkout", "-q", "--detach")
        g = look(repo)
        assert g["branch"] is None and g["oid"] == git(repo, "rev-parse", "HEAD"), g

        # packed refs, a worktree, index version 4
        git(repo, "checkout", "-q", "main")
        git(repo, "pack-refs", "--all")
        h = look(repo)
        assert h["oid"] == git(repo, "rev-parse", "HEAD") and h["upOid"] == git(repo, "rev-parse", "origin/main"), h
        wt = f"{tmp}/wt"
        git(repo, "worktree", "add", "-q", wt, "-b", "agent/fix", "main")
        w = look(wt, f"{repo}/.git/worktrees/wt", f"{repo}/.git")
        assert w["branch"] == "agent/fix" and w["oid"] == h["oid"] and w["onRemote"] is True and w["stash"] == 1 and w["fp"], w
        write(f"{wt}/src/app/main.js", "changed in the worktree\n")
        assert look(wt, f"{repo}/.git/worktrees/wt", f"{repo}/.git")["fp"] != w["fp"]
        assert look(repo)["fp"] == h["fp"]                       # the repo's own checkout did not move
        for i in range(30):
            write(f"{repo}/src/deep/dir{i % 3}/file-with-a-shared-prefix-{i}.txt", "x")
        git(repo, "add", "-A")
        v2 = probe.index_entries(open(f"{repo}/.git/index", "rb").read())
        git(repo, "update-index", "--index-version", "4")
        v4 = probe.index_entries(open(f"{repo}/.git/index", "rb").read())
        listed = git(repo, "ls-files", "-z").split("\0")[:-1]
        assert [e[0].decode() for e in v2] == listed and [e[0] for e in v4] == [e[0] for e in v2], "index versions 2 and 4 list the same paths"
        assert look(repo)["fp"]

        # what it cannot read: no fingerprint, never a wrong one
        assert probe.index_entries(b"DIRC\0\0\0\x02\0\0\0\0" + bytes(20)) == []   # an empty index is fine
        assert probe.index_entries(b"nope") is None and probe.index_entries(b"DIRC\0\0\0\x09\0\0\0\0") is None
        cut = open(f"{repo}/.git/index", "rb").read()[:200]
        assert probe.index_entries(cut) is None
        os.makedirs(f"{repo}/.git/reftable")
        assert look(repo)["fp"] is None
        os.rmdir(f"{repo}/.git/reftable")
        assert look(f"{tmp}/missing")["fp"] is None

        # the command line: one JSON line per checkout, in order
        out = subprocess.run([sys.executable, probe.__file__, repo, f"{repo}/.git", f"{repo}/.git", wt, f"{repo}/.git/worktrees/wt", f"{repo}/.git"],
                             capture_output=True, text=True, check=True).stdout.splitlines()
        assert [json.loads(line)["path"] for line in out] == [repo, wt]
    print("ok")


if __name__ == "__main__":
    main()
