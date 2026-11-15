#!/usr/bin/env python3
"""What changed in these checkouts, from files alone: one process for many checkouts, no git child processes.

    python3 probe.py <path> <gitdir> <common> [<path> <gitdir> <common> ...]

Prints one JSON line per checkout:
    {"path", "fp", "branch", "oid", "upstream", "upOid", "onRemote", "remotes", "stash",
     "t": {"head", "index", "files", "fetch"}}          times in ms, null when unknown
fp is a fingerprint of everything `git status` depends on that can be read without git: HEAD and upstream
commits, what the index lists (paths, blobs, flags: not its file time, which every `git status` of another tool
moves), every tracked file's times and size, the modification times of their
folders and of the folders right below them (where untracked files would show up), the stash and the remote refs.
Each file and folder goes into a digest with its own times, not as one newest time: a single file dated in the
future would hide every later change behind it.
The same fp as last time means git status would say the same, so the mod does not ask git again. fp is null when
this script cannot tell (a ref backend or an index it does not read, a split index, a checked-out submodule):
the mod asks git then.
Known gap: a new untracked file two or more levels below any tracked folder, inside a folder that existed before
and held only ignored files, does not change fp.
Reads only. Standard library only.
"""
import hashlib
import json
import os
import struct
import sys

EXTENSIONS = {b"TREE", b"REUC", b"UNTR", b"FSMN", b"EOIE", b"IEOT", b"sdir"}  # not "link": see index_entries


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


def index_entries(data, digest=None):
    """[(path bytes, mtime ns, size, mode, skip)] of a git index (versions 2 to 4), or None when it is not one.
    digest (a hashlib object) is fed every entry's path, mode, blob and flags: what is staged, without the cached
    file times that a refresh rewrites."""
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
            if digest is not None:
                digest.update(path + b"\0" + data[start + 24:start + 28] + data[start + 40:start + 62] + (b"s" if skip else b""))
            out.append((path, ms * 1_000_000_000 + mn, size, mode, skip))
    except (struct.error, ValueError, IndexError):
        return None
    # What follows the entries: extensions (a name, a length, that many bytes), then the checksum (20 bytes, or 32
    # in a SHA-256 repo). A name this does not know means a format it does not read. So does "link": a split
    # index keeps most entries in a sharedindex file, and the ones listed here are not the whole checkout.
    while len(data) - pos > 20 and not (len(data) - pos == 32 and data[pos:pos + 4] not in EXTENSIONS):
        if data[pos:pos + 4] not in EXTENSIONS or len(data) - pos < 8:
            return None
        pos += 8 + struct.unpack(">I", data[pos + 4:pos + 8])[0]
    if len(data) - pos not in (20, 32):
        return None
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
        stamp = [("packed-refs", mtime_ms(os.path.join(common, "packed-refs")) or 0)]
        for root, _dirs, files in os.walk(os.path.join(common, "refs", "remotes")):
            stamp.append((root, mtime_ms(root) or 0))
            for f in files:
                p = os.path.join(root, f)
                stamp.append((p, mtime_ms(p) or 0))
                text = read(p)
                if text and not text.startswith("ref: "):
                    oids.add(text.strip())
        # every ref's own time, not the newest of them: one dated in the future would hide the others
        cache[key] = (oids, hashlib.blake2b(repr(sorted(stamp)).encode(), digest_size=8).hexdigest())
    return cache[key]


def worktree(path, entries):
    """(digest of every tracked file's and folder's times, missing, newest changed tracked file ms, submodules).
    submodules: how many of them are checked out (what changes inside one is not read here)."""
    seen = hashlib.blake2b(digest_size=8)
    missing = submodules = 0
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
            seen.update(b"%d;" % st.st_mtime_ns)
            submodules += os.path.lexists(os.path.join(path, rel, b".git"))
            continue
        seen.update(b"%d,%d,%d;" % (st.st_mtime_ns, st.st_ctime_ns, st.st_size))
        if st.st_mtime_ns != cached_mtime or st.st_size & 0xFFFFFFFF != cached_size:
            changed = max(changed or 0, int(st.st_mtime * 1000))
    for d in sorted(dirs):
        full = os.path.join(path, d) if d else path
        try:
            seen.update(b"%d;" % os.lstat(full).st_mtime_ns)
            with os.scandir(full) as it:  # the folders right below: where untracked files would appear
                below = [(e.name, e.stat(follow_symlinks=False).st_mtime_ns) for e in it
                         if e.is_dir(follow_symlinks=False) and e.name != b".git" and (d + b"/" + e.name if d else e.name) not in dirs]
            for name, at in sorted(below):
                seen.update(name + b"=%d;" % at)
        except OSError:
            missing += 1
    return seen.hexdigest(), missing, changed, submodules


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
    staged = hashlib.blake2b(digest_size=8)
    entries = [] if data is None else index_entries(data, staged)
    if entries is None:
        return out
    seen, missing, changed, submodules = worktree(os.fsencode(path), entries)
    out["t"]["files"] = changed
    # ponytail: a checkout with a checked-out submodule gets no fingerprint, so git is asked for it at every check.
    # Reading the submodule's own HEAD and index here would spare that; worth it once such repos are many.
    if not submodules:
        out["fp"] = "|".join(str(x) for x in (out["oid"], out["upOid"], staged.hexdigest(), seen, len(entries), missing, out["stash"], remote_stamp))
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
