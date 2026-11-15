#!/usr/bin/env python3
"""What changed in these checkouts, from files alone: one process for many checkouts, no git child processes.

    python3 probe.py <path> <gitdir> <common> [<path> <gitdir> <common> ...]

Prints one JSON line per checkout:
    {"path", "fp", "branch", "oid", "upstream", "upOid", "onRemote", "remotes", "stash",
     "t": {"head", "index", "files", "fetch"}}          times in ms, null when unknown
fp is a fingerprint of everything `git status` depends on that can be read without git: HEAD and upstream
commits, the index file, the newest change time among the tracked files, the modification times of their
folders and of the folders right below them (where untracked files would show up), the stash and the remote refs.
The same fp as last time means git status would say the same, so the mod does not ask git again. fp is null when
this script cannot tell (a ref backend or an index it does not read): the mod asks git then.
Known gap: a new untracked file two or more levels below any tracked folder, inside a folder that existed before
and held only ignored files, does not change fp.
Reads only. Standard library only.
"""
import json
import os
import struct
import sys

EXTENSIONS = {b"TREE", b"REUC", b"link", b"UNTR", b"FSMN", b"EOIE", b"IEOT", b"sdir"}


def read(path, mode="r"):
    try:
        with open(path, mode, **({} if "b" in mode else {"encoding": "utf-8", "errors": "replace"})) as f:
            return f.read()
    except OSError:
        return None


def mtime_ms(path):
    try:
        return int(os.stat(path).st_mtime * 1000)
    except OSError:
        return None


def index_entries(data):
    """[(path bytes, mtime ns, size, mode, skip)] of a git index (versions 2 to 4), or None when it is not one."""
    if not data or len(data) < 12 or data[:4] != b"DIRC":
        return None
    version, count = struct.unpack(">II", data[4:12])
    if version not in (2, 3, 4):
        return None
    out, pos, prev = [], 12, b""
    try:
        for _ in range(count):
            start = pos
            _cs, _cn, ms, mn, _dev, _ino, mode, _uid, _gid, size = struct.unpack(">10I", data[pos:pos + 40])
            flags = struct.unpack(">H", data[pos + 60:pos + 62])[0]
            pos += 62
            skip = False
            if version >= 3 and flags & 0x4000:
                skip = bool(struct.unpack(">H", data[pos:pos + 2])[0] & 0x4000)  # skip-worktree
                pos += 2
            if version == 4:
                byte = data[pos]  # a varint in git's offset encoding: how much of the previous path to drop
                pos += 1
                strip = byte & 0x7F
                while byte & 0x80:
                    byte = data[pos]
                    pos += 1
                    strip = ((strip + 1) << 7) + (byte & 0x7F)
                end = data.index(b"\0", pos)
                path = prev[:len(prev) - strip] + data[pos:end]
                pos = end + 1
            else:
                end = data.index(b"\0", pos)
                path = data[pos:end]
                pos = start + ((end - start + 8) // 8) * 8  # padded with 1 to 8 NULs to a multiple of 8
            prev = path
            out.append((path, ms * 1_000_000_000 + mn, size, mode, skip))
    except (struct.error, ValueError, IndexError):
        return None
    rest = len(data) - pos
    if rest not in (20, 32) and data[pos:pos + 4] not in EXTENSIONS:
        return None  # not where the entries end: a format this does not read
    return out


def packed(common, cache):
    """{ref name: oid} from packed-refs of one repo."""
    if common not in cache:
        refs = {}
        for line in (read(os.path.join(common, "packed-refs")) or "").splitlines():
            if line and line[0] not in "#^" and " " in line:
                oid, name = line.split(" ", 1)
                refs[name.strip()] = oid
        cache[common] = refs
    return cache[common]


def resolve(common, gitdir, name, cache):
    """A ref's commit: the loose file (the worktree's own first), else packed-refs."""
    for base in (gitdir, common):
        text = read(os.path.join(base, name))
        if text:
            text = text.strip()
            return resolve(common, gitdir, text[5:], cache) if text.startswith("ref: ") else text
    return packed(common, cache).get(name)


def branches(common, cache):
    """{branch: (remote, merge ref)} from the repo's config."""
    key = ("config", common)
    if key not in cache:
        out, section = {}, None
        for raw in (read(os.path.join(common, "config")) or "").splitlines():
            line = raw.strip()
            if line.startswith("["):
                section = line[9:-2] if line.startswith('[branch "') and line.endswith('"]') else None
            elif section is not None and "=" in line:
                k, v = (x.strip() for x in line.split("=", 1))
                out.setdefault(section, {})[k.lower()] = v
        cache[key] = {b: (v.get("remote"), v.get("merge")) for b, v in out.items()}
    return cache[key]


def remotes(common, cache):
    """(every remote ref's commit, a stamp that changes when remote refs change) of one repo."""
    key = ("remotes", common)
    if key not in cache:
        oids = {oid for name, oid in packed(common, cache).items() if name.startswith("refs/remotes/")}
        stamp = [mtime_ms(os.path.join(common, "packed-refs")) or 0]
        for root, _dirs, files in os.walk(os.path.join(common, "refs", "remotes")):
            stamp.append(mtime_ms(root) or 0)
            for f in files:
                p = os.path.join(root, f)
                stamp.append(mtime_ms(p) or 0)
                text = read(p)
                if text and not text.startswith("ref: "):
                    oids.add(text.strip())
        cache[key] = (oids, f"{max(stamp)}.{len(stamp)}")
    return cache[key]


def worktree(path, entries):
    """(newest change among tracked files ns, newest folder change ns, missing, newest changed tracked file ms)."""
    newest = folders = missing = 0
    changed = None
    dirs = {b""}
    for rel, cached_mtime, cached_size, mode, skip in entries:
        cut = rel.rfind(b"/")
        while cut > 0 and rel[:cut] not in dirs:
            dirs.add(rel[:cut])
            cut = rel.rfind(b"/", 0, cut)
        if skip:
            continue
        try:
            st = os.lstat(os.path.join(path, rel))
        except OSError:
            missing += 1
            continue
        if mode & 0o170000 == 0o160000:  # a submodule: its folder counts with the folders
            folders = max(folders, st.st_mtime_ns)
            continue
        newest = max(newest, st.st_ctime_ns, st.st_mtime_ns)
        if st.st_mtime_ns != cached_mtime or st.st_size & 0xFFFFFFFF != cached_size:
            changed = max(changed or 0, int(st.st_mtime * 1000))
    for d in dirs:
        full = os.path.join(path, d) if d else path
        try:
            folders = max(folders, os.lstat(full).st_mtime_ns)
            with os.scandir(full) as it:  # the folders right below: where untracked files would appear
                for e in it:
                    if e.is_dir(follow_symlinks=False) and e.name != b".git" and (d + b"/" + e.name if d else e.name) not in dirs:
                        folders = max(folders, e.stat(follow_symlinks=False).st_mtime_ns)
        except OSError:
            missing += 1
    return newest, folders, missing, changed


def probe(path, gitdir, common, cache):
    out = {"path": path, "fp": None, "branch": None, "oid": None, "upstream": None, "upOid": None, "onRemote": False, "remotes": None, "stash": 0,
           "t": {"head": mtime_ms(os.path.join(gitdir, "logs", "HEAD")) or mtime_ms(os.path.join(gitdir, "HEAD")),
                 "index": mtime_ms(os.path.join(gitdir, "index")), "files": None, "fetch": mtime_ms(os.path.join(common, "FETCH_HEAD"))}}
    head = (read(os.path.join(gitdir, "HEAD")) or "").strip()
    if not head or os.path.isdir(os.path.join(common, "reftable")):
        return out  # no HEAD, or refs kept in a format this does not read
    if head.startswith("ref: refs/heads/"):
        out["branch"] = head[16:]
        out["oid"] = resolve(common, gitdir, head[5:], cache)
        remote, merge = branches(common, cache).get(out["branch"], (None, None))
        if remote and merge and merge.startswith("refs/heads/"):
            out["upstream"] = f"{remote}/{merge[11:]}"
            out["upOid"] = resolve(common, gitdir, f"refs/remotes/{remote}/{merge[11:]}", cache)
    elif not head.startswith("ref: "):
        out["oid"] = head
    remote_oids, remote_stamp = remotes(common, cache)
    out["onRemote"] = bool(out["oid"] and out["oid"] in remote_oids)
    out["remotes"] = remote_stamp
    if resolve(common, common, "refs/stash", cache):
        out["stash"] = len((read(os.path.join(common, "logs", "refs", "stash")) or "").splitlines())
    data = read(os.path.join(gitdir, "index"), "rb")
    entries = [] if data is None else index_entries(data)
    if entries is None:
        return out
    newest, folders, missing, changed = worktree(os.fsencode(path), entries)
    out["t"]["files"] = changed
    try:
        st = os.stat(os.path.join(gitdir, "index"))
        index = f"{st.st_mtime_ns}:{st.st_size}"
    except OSError:
        index = "none"
    out["fp"] = "|".join(str(x) for x in (out["oid"], out["upOid"], index, newest, folders, len(entries), missing, out["stash"], remote_stamp))
    return out


def main(argv):
    cache = {}
    for i in range(0, len(argv) - 2, 3):
        path, gitdir, common = argv[i:i + 3]
        try:
            line = probe(path, gitdir, common, cache)
        except Exception as e:  # one odd checkout must not cost the others their answer
            line = {"path": path, "fp": None, "error": f"{type(e).__name__}: {e}"[:160]}
        sys.stdout.write(json.dumps(line) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main(sys.argv[1:])
