// The history view's logic: `git log` text to commits, which commits to fold away, and which lane each row draws in.
// No gpui, no herdr: checked with `node --test test_graph.mjs`.

// ---- git log ---------------------------------------------------------------------------------------------------

// One record per commit, NUL-terminated (-z): hash, parents, refs (full names), subject, author, author time.
export const LOG_FORMAT = ["%H", "%P", "%D", "%s", "%an", "%at"].join("%x1f");

// What to list. "branches": every local branch and the base; "branch": one branch and the base; "all": every ref.
// One commit more than `max` is asked for, to know whether there are more.
export function logArgs(mode, { base = null, branch = null, max = 400 } = {}) {
  const [sets, revs] = mode === "all" ? [["--exclude=refs/stash", "--all"], ["HEAD"]]
    : mode === "branch" && branch ? [[], [...new Set([branch, base].filter(Boolean))]]
    : [["--branches"], ["HEAD", ...(base ? [base] : [])]];
  // --end-of-options: a branch name is never read as an option
  return ["log", "--topo-order", "--decorate=full", "-z", `--format=${LOG_FORMAT}`, "-n", String(max + 1), ...sets, "--end-of-options", ...revs, "--"];
}

// "HEAD -> refs/heads/main, refs/remotes/origin/main, tag: refs/tags/v1" -> {head, heads, remotes, tags}.
// head: the checked-out branch's name, true for a detached HEAD, else null. origin/HEAD and other refs are left out.
export function refsOf(decoration) {
  const out = { head: null, heads: [], remotes: [], tags: [] };
  for (let item of (decoration ?? "").split(", ")) {
    if (item === "HEAD") { out.head = true; continue; }
    const at = item.startsWith("HEAD -> ");
    if (at) item = item.slice(8);
    if (item.startsWith("tag: refs/tags/")) out.tags.push(item.slice(15));
    else if (item.startsWith("refs/heads/")) { out.heads.push(item.slice(11)); if (at) out.head = item.slice(11); }
    else if (item.startsWith("refs/remotes/") && !item.endsWith("/HEAD")) out.remotes.push(item.slice(13));
  }
  return out;
}

// {commits: [{hash, parents, refs, subject, author, at}], more}: `more` when git had more than `max`.
export function parseLog(text, max = Infinity) {
  const commits = [];
  for (const rec of (text ?? "").split("\0")) {
    const [hash, parents, deco, subject, author, at] = rec.replace(/^\n/, "").split("\x1f");
    if (!hash || hash.length < 7 || subject === undefined) continue;
    commits.push({ hash, parents: parents ? parents.split(" ") : [], refs: refsOf(deco), subject, author: author ?? "", at: +at * 1000 || null });
  }
  return { commits: commits.slice(0, max), more: commits.length > max };
}

// The marks next to a commit. A local branch and a remote branch of the same name on the same commit are one
// chip ("feat/x ⇄ origin"); a remote branch alone, a tag and a detached HEAD are their own.
export function chips(refs) {
  const paired = new Set(), out = [];
  if (refs.head === true) out.push({ kind: "head", name: "HEAD" });
  for (const name of refs.heads) {
    const synced = refs.remotes.filter((r) => r.slice(r.indexOf("/") + 1) === name);
    synced.forEach((r) => paired.add(r));
    out.push({ kind: "branch", name, head: refs.head === name, synced: synced.map((r) => r.slice(0, r.indexOf("/"))) });
  }
  for (const r of refs.remotes) if (!paired.has(r)) out.push({ kind: "remote", name: r });
  for (const t of refs.tags) out.push({ kind: "tag", name: t });
  return out;
}

// ---- what to show ------------------------------------------------------------------------------------------------

// The commits reachable from `tip` (the base branch's commit): what counts as merged.
export function reachable(commits, tip) {
  const by = new Map(commits.map((c) => [c.hash, c])), seen = new Set();
  for (const stack = by.has(tip) ? [tip] : []; stack.length;) {
    const h = stack.pop();
    if (seen.has(h)) continue;
    seen.add(h);
    for (const p of by.get(h)?.parents ?? []) if (by.has(p) && !seen.has(p)) stack.push(p);
  }
  return seen;
}

// The readable view: a commit is shown when it is not merged into the base yet, carries a branch, tag or HEAD, is
// where an unmerged branch forks off, or is the base's own tip. Plain merged history is left to be folded.
// With a filter (lower case): only commits whose subject or ref names contain it.
export function shown(commits, { base = null, all = false, filter = "" } = {}) {
  if (filter) {
    const hit = (c) => c.subject.toLowerCase().includes(filter) || [...c.refs.heads, ...c.refs.remotes, ...c.refs.tags].some((r) => r.toLowerCase().includes(filter));
    return new Set(commits.filter(hit).map((c) => c.hash));
  }
  if (all || !base) return new Set(commits.map((c) => c.hash));
  const merged = reachable(commits, base), out = new Set([base]);
  for (const c of commits) {
    const marked = c.refs.head || c.refs.heads.length || c.refs.remotes.length || c.refs.tags.length;
    if (!merged.has(c.hash)) { out.add(c.hash); for (const p of c.parents) if (merged.has(p)) out.add(p); }
    else if (marked) out.add(c.hash);
  }
  return out;
}

// Rows to draw: a node per shown commit, and one fold node per connected stretch of at least `minFold` hidden
// commits between them ({id: "fold:<first hash>", fold: how many, parents}); a fold named in `open` is listed
// commit by commit instead.
// Parents are rewritten so that every node's parents are nodes below it (or commits git did not list).
export function plan(commits, visible, open = new Set(), minFold = 3) {
  const pos = new Map(commits.map((c, i) => [c.hash, i]));
  const owner = new Map(); // hidden hash -> its fold id
  const nodes = [];
  for (let i = 0; i < commits.length;) {
    if (visible.has(commits[i].hash)) { nodes.push({ id: commits[i].hash, commit: commits[i], parents: commits[i].parents }); i++; continue; }
    let j = i;
    while (j < commits.length && !visible.has(commits[j].hash)) j++;
    // The hidden stretch i..j, split into connected pieces (a commit and a hidden parent belong together).
    const root = new Map(commits.slice(i, j).map((c) => [c.hash, c.hash]));
    const find = (h) => { while (root.get(h) !== h) { root.set(h, root.get(root.get(h))); h = root.get(h); } return h; };
    for (let k = i; k < j; k++) for (const p of commits[k].parents) if (root.has(p)) root.set(find(p), find(commits[k].hash));
    const pieces = new Map();
    for (let k = i; k < j; k++) { const r = find(commits[k].hash); (pieces.get(r) ?? pieces.set(r, []).get(r)).push(commits[k]); }
    const out = [];
    for (const members of pieces.values()) { // members are in list order
      const id = `fold:${members[0].hash}`;
      // "· 1 commit ·" says less than the commit itself: short stretches are listed
      if (members.length < minFold) { for (const c of members) out.push([pos.get(c.hash), { id: c.hash, commit: c, parents: c.parents }]); continue; }
      if (open.has(id)) { for (const c of members) out.push([pos.get(c.hash), { id: c.hash, commit: c, parents: c.parents, unfolded: id }]); continue; }
      const mine = new Set(members.map((c) => c.hash));
      members.forEach((c) => owner.set(c.hash, id));
      out.push([pos.get(members[0].hash), { id, fold: members.length, commit: null, parents: [...new Set(members.flatMap((c) => c.parents).filter((p) => !mine.has(p)))] }]);
    }
    nodes.push(...out.sort((a, b) => a[0] - b[0]).map(([, n]) => n));
    i = j;
  }
  for (const n of nodes) n.parents = [...new Set(n.parents.map((p) => owner.get(p) ?? p))].filter((p) => p !== n.id);
  return nodes;
}

// ---- lanes -------------------------------------------------------------------------------------------------------

// A lane's name: the first local branch on its topmost node, else that node's id. Its color follows from the name
// (so a branch keeps its color from one look to the next), moved on to the next free one while another lane that
// is being drawn has it.
const PALETTE = 6;
const nameOf = (node) => node?.commit?.refs.heads[0] ?? node?.id ?? "";
export function colorOf(name, palette = PALETTE) {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619) >>> 0;
  return h % palette;
}

// A color for every branch of the repo, the same whatever part of the history is listed: by name, in name order,
// each one the color its name points at, or the least used one after it when that is taken.
export function palette(names, size = PALETTE) {
  const used = Array(size).fill(0), out = new Map();
  for (const name of [...new Set(names)].sort()) {
    let c = colorOf(name, size);
    for (let k = 1; k < size; k++) { const d = (colorOf(name, size) + k) % size; if (used[d] < used[c]) c = d; }
    used[c]++; out.set(name, c);
  }
  return out;
}

// For every node, top to bottom, what to draw in its row:
//   lane: the node's own; name: its lane's name; color: 0..5, or -1 for the base
//   top: lines arriving at the node from above, [{from: lane, name, color}] (from === lane: straight)
//   bottom: lines leaving it downwards, [{to: lane, name, color}] (to === lane: straight)
//   through: lanes passing by, [{lane, name, color}]
// width: how many lanes are used; colors: Map(lane name -> color).
// colors (in): Map(branch name -> color) from `palette`; lanes without a branch get a free color as they come.
// The base branch (`base`: its tip's node id) keeps lane 0 from the first row on. A lane that ended is used again
// by the next branch that needs one, the leftmost first. A parent git did not list keeps its lane open to the end.
export function lanes(nodes, { base = null, colors: given = null } = {}) {
  const by = new Map(nodes.map((n) => [n.id, n]));
  const active = []; // lane -> {want: node id, name, fed: a line from above ends here} | null
  const free = () => { let k = 0; while (active[k]) k++; return k; };
  const waiting = (id) => active.flatMap((a, k) => (a && a.want === id ? [k] : []));
  const colors = new Map(given ?? []);
  const tint = (name) => {
    if (!colors.has(name)) {
      const used = new Set(active.filter(Boolean).map((a) => a.color));
      let c = colorOf(name);
      for (let k = 0; k < PALETTE && used.has(c); k++) c = (c + 1) % PALETTE;
      colors.set(name, c);
    }
    return colors.get(name);
  };
  if (base && by.has(base)) { const name = nameOf(by.get(base)); colors.set(name, -1); active[0] = { want: base, name, color: -1, fed: false }; }
  let width = 0;
  const rows = nodes.map((node) => {
    const mine = waiting(node.id);
    let lane = mine[0];
    if (lane === undefined) { lane = free(); const name = nameOf(node); active[lane] = { want: node.id, name, color: tint(name), fed: false }; }
    const { name, color } = active[lane];
    const top = mine.filter((k) => active[k].fed).map((k) => ({ from: k, name: active[k].name, color: active[k].color }));
    const through = active.flatMap((a, k) => (a && a.fed && !mine.includes(k) && k !== lane ? [{ lane: k, name: a.name, color: a.color }] : []));
    for (const k of mine) if (k !== lane) active[k] = null;
    active[lane] = null;
    const bottom = [];
    node.parents.forEach((p, i) => {
      const there = waiting(p)[0];
      // The first parent always goes straight down: a branch keeps its lane until the commit it forked from, and
      // the lanes meet there (which also keeps the base on lane 0). A merged-in parent bends over to the lane that
      // already draws towards it, if there is one.
      if (there !== undefined && i > 0) { active[there].fed = true; bottom.push({ to: there, name: active[there].name, color: active[there].color }); }
      else {
        const k = i === 0 ? lane : free();
        const mine2 = i === 0 ? name : (by.has(p) ? nameOf(by.get(p)) : p);
        active[k] = { want: p, name: mine2, color: i === 0 ? color : tint(mine2), fed: true };
        bottom.push({ to: k, name: mine2, color: active[k].color });
      }
    });
    width = Math.max(width, lane + 1, ...through.map((x) => x.lane + 1), ...top.map((x) => x.from + 1), ...bottom.map((x) => x.to + 1));
    return { lane, name, color, top, bottom, through };
  });
  return { rows, width, colors };
}

// ---- words -------------------------------------------------------------------------------------------------------

// A long name with its middle left out, so that both ends stay readable: "feat/very-long…-and-its-end".
export function middle(text, max) {
  if (text.length <= max || max < 5) return text;
  const head = Math.ceil((max - 1) * 0.55), tail = max - 1 - head;
  return `${text.slice(0, head)}…${text.slice(text.length - tail)}`;
}

// "Ada Lovelace" -> "AL", "ada" -> "A".
export const initials = (name) => (name ?? "").split(/[\s._-]+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("");

// A Conventional Commit subject split at its type: "feat(api)!: add x" -> {type: "feat", lead: "feat(api)!:", rest: "add x"}.
export function conventional(subject) {
  const m = /^([a-z]+)(\([^)]*\))?(!)?:\s*/.exec(subject ?? "");
  return m ? { type: m[1], lead: m[0].trimEnd(), rest: subject.slice(m[0].length) } : { type: null, lead: "", rest: subject ?? "" };
}

// `git show --numstat --format=%an%x1f%aI%x1f%B%x1e <hash>` -> {author, date, message, files: [{path, add, del}]}.
// add/del are null for a binary file.
export function parseShow(text) {
  const cut = (text ?? "").indexOf("\x1e");
  const [author = "", date = "", message = ""] = (cut < 0 ? "" : text.slice(0, cut)).split("\x1f");
  const files = (cut < 0 ? "" : text.slice(cut + 1)).split("\n").map((l) => l.split("\t")).filter((f) => f.length >= 3)
    .map(([add, del, ...path]) => ({ path: path.join("\t"), add: add === "-" ? null : +add, del: del === "-" ? null : +del }));
  return { author, date, message: message.trim(), files };
}
