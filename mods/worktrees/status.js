// Parses `git status --porcelain=v2 --branch --show-stash -z`. Pure, so it can be checked with node.
// tracked: changed files git knows (1, 2, u); untracked: new files (?); stash: entries of the repo's stash;
// files: the first FILES changed tracked paths, for their age (model.js touched).
const FILES = 12;
const PATH_AT = { 1: 8, 2: 9, u: 10 }; // fields before the path, per entry kind

export function parse(out) {
  const s = { branch: null, oid: null, detached: false, upstream: null, ahead: 0, behind: 0, tracked: 0, untracked: 0, stash: 0, files: [] };
  const parts = out.split("\0");
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p.startsWith("# branch.oid ")) s.oid = p.slice(13);
    else if (p.startsWith("# branch.head ")) { const h = p.slice(14); s.detached = h === "(detached)"; s.branch = s.detached ? null : h; }
    else if (p.startsWith("# branch.upstream ")) s.upstream = p.slice(18);
    else if (p.startsWith("# branch.ab ")) { const m = /\+(\d+) -(\d+)/.exec(p); if (m) { s.ahead = +m[1]; s.behind = +m[2]; } }
    else if (p.startsWith("# stash ")) s.stash = +p.slice(8) || 0;
    else if (p.startsWith("? ")) s.untracked++;
    else if (/^[12u] /.test(p)) {
      s.tracked++;
      if (s.files.length < FILES) s.files.push(p.split(" ").slice(PATH_AT[p[0]]).join(" "));
      if (p[0] === "2") i++; // a rename carries its old path as the next field
    }
  }
  return s;
}
