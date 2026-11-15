// What the panel shows, worked out from text: git's output, files under .git, and what other mods published.
// No gpui, no herdr: checked with `node --test test_model.mjs`.

export const DAY = 24 * 60 * 60 * 1000;

// ---- settings: <app home>/<name>.config.json, every key optional ---------------------------------------------------

export const DEFAULTS = {
  roots: ["~/code", "~/src", "~/projects", "~/dev"],  // folders searched for git checkouts
  worktreeRoots: ["~/.herdr/worktrees"],                // agents' checkouts; Herdr's own folder for them is added (herdrWorktrees)
  prune: ["node_modules", "build", "dist", "target", ".venv", ".terraform"], // folder names never entered
  depth: 4,                                             // how deep under a root a checkout may be
  max: 500,                                             // at most this many checkouts
  weekDays: 7,                                          // "Changed this week": tracked changes this young
  goto: true,                                           // offer the listed checkouts in Go to, when it is installed
};

const abs = (dir, home) => norm(dir === "~" || dir.startsWith("~/") ? `${home}${dir.slice(1)}` : dir.startsWith("/") ? dir : `${home}/${dir}`);
const list = (v, fallback) => (Array.isArray(v) ? v.filter((x) => typeof x === "string" && x) : fallback);
const int = (v, fallback, lo, hi) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : fallback);

// Where Herdr's New worktree puts checkouts: "worktrees": {"directory"} in the settings.json of the Herdr home, an
// absolute path or one from "~"; anything else, or no file, is Herdr's default.
export function herdrWorktrees(text, home) {
  let dir = null;
  try { dir = JSON.parse(text ?? "null")?.worktrees?.directory; } catch {}
  return abs(typeof dir === "string" && /^(~$|~\/|\/)/.test(dir) ? dir : DEFAULTS.worktreeRoots[0], home);
}

// The settings with defaults filled in and folders made absolute ("~/x", "/x", or relative to the home).
// A root is never "/" or the home itself. Text that is not JSON counts as no file.
// herdrDir (herdrWorktrees): one more worktree root, unless "worktreeRoots": [] turned agents' worktrees off.
export function configOf(text, home, herdrDir = null) {
  let doc = null;
  try { doc = text ? JSON.parse(text) : null; } catch {}
  doc = doc && typeof doc === "object" ? doc : {};
  const dirs = (v, fallback) => [...new Set(list(v, fallback).map((d) => abs(d, home)))].filter((d) => d !== "/" && d !== norm(home));
  const agents = list(doc.worktreeRoots, DEFAULTS.worktreeRoots);
  return {
    roots: dirs(doc.roots, DEFAULTS.roots),
    worktreeRoots: dirs(agents.length && herdrDir ? [...agents, herdrDir] : agents, []),
    prune: list(doc.prune, DEFAULTS.prune).filter((n) => !n.includes("/")),
    depth: int(doc.depth, DEFAULTS.depth, 1, 8),
    max: int(doc.max, DEFAULTS.max, 1, 5000),
    weekDays: int(doc.weekDays, DEFAULTS.weekDays, 1, 365),
    goto: doc.goto !== false,
    editors: Array.isArray(doc.editors) ? doc.editors : [], // more editors for "Open in <Editor>" (editor.js extraEditors)
    dryRun: doc.dryRun === true, // "Open in <Editor>" starts nothing and notes what it would have started
  };
}

// May this path be handed to Herdr as something to drag onto a terminal: absolute, and no control characters
// (Herdr refuses those, and a refusal while drawing would take the whole view with it).
export const draggable = (path) => typeof path === "string" && path.startsWith("/") && !/[\u0000-\u001f\u007f]/.test(path);

const under = (path, dir) => path === dir || path.startsWith(`${dir}/`);
export const rootOf = (path, roots) => roots.filter((r) => under(path, r)).sort((a, b) => b.length - a.length)[0] ?? null;

export function norm(path) {
  const out = [];
  for (const seg of path.split("/")) {
    if (seg === "..") out.pop();
    else if (seg && seg !== ".") out.push(seg);
  }
  return `/${out.join("/")}`;
}

// A checkout's git folders. `.git` is a folder in a normal repo; in a worktree (or submodule) it is a file
// "gitdir: <path>". main: the repo a worktree belongs to; common: where config and remote refs live.
export function gitLink(text, path) {
  const m = /^gitdir:\s*(.+)$/m.exec(text ?? "");
  if (!m) return { gitdir: `${path}/.git`, common: `${path}/.git`, main: null };
  const gitdir = norm(m[1].trim().startsWith("/") ? m[1].trim() : `${path}/${m[1].trim()}`);
  const wt = /^(.*)\/\.git\/worktrees\/[^/]+$/.exec(gitdir);
  return wt ? { gitdir, common: `${wt[1]}/.git`, main: wt[1] } : { gitdir, common: gitdir, main: null };
}

// From .git/config: is there any remote, its URL, and origin's GitHub owner/repo (what PR data is keyed by).
export function remoteOf(config) {
  const urls = {};
  let section = null;
  for (const raw of (config ?? "").split("\n")) {
    const line = raw.trim();
    const sec = /^\[remote "(.+)"\]$/.exec(line);
    if (sec) section = sec[1];
    else if (line.startsWith("[")) section = null;
    else if (section) { const u = /^url\s*=\s*(.+)$/.exec(line); if (u) urls[section] ??= u[1].trim(); }
  }
  const url = urls.origin ?? Object.values(urls)[0] ?? null;
  return { hasRemote: Boolean(url), url, slug: /github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?\/?$/.exec(url ?? "")?.[1] ?? null };
}

// One scanned checkout: {path, kind: "repo" | "worktree" | "agent", main, gitdir, common, name, rel}.
// "agent": a worktree under one of the worktree roots. A worktree carries the name of the repo it belongs to.
// rel: the path below its root, for the "All" list.
export function describe(path, gitText, { roots, worktreeRoots }) {
  const link = gitLink(gitText, path);
  const root = rootOf(path, [...roots, ...worktreeRoots]);
  const base = (p) => p.slice(p.lastIndexOf("/") + 1);
  return {
    path, ...link,
    kind: worktreeRoots.includes(root) ? "agent" : link.main ? "worktree" : "repo",
    name: link.main ? base(link.main) : base(path),
    rel: root && path !== root ? path.slice(root.length + 1) : base(path),
  };
}

// ---- contexts: the optional hook another mod publishes as shared "goto.context" ------------------------------------

// A checkout's context id, or null: the longest folder prefix of the hook that holds it (a worktree asks for the
// repo it belongs to first), else the first remote pattern that matches its URL. Ids are opaque.
export function contextOf(repo, hook, home) {
  if (!hook) return null;
  const folders = (hook.folders ?? []).filter((f) => Array.isArray(f) && typeof f[0] === "string").map(([dir, id]) => [abs(dir, home).toLowerCase(), id]).sort((a, b) => b[0].length - a[0].length);
  for (const path of [repo.main, repo.path].filter(Boolean)) {
    const hit = folders.find(([dir]) => under(path.toLowerCase(), dir));
    if (hit) return hit[1];
  }
  for (const [pattern, id] of hook.remotes ?? []) {
    try { if (repo.url && new RegExp(pattern, "i").test(repo.url)) return id; } catch {}
  }
  return null;
}

// What a view lists: everything, or with the hook's `current` set only that context's checkouts (a checkout of
// no context is then left out, so one setup never shows another's repos).
export const inView = (repos, hook) => (hook?.current ? repos.filter((r) => r.context === hook.current) : repos);

// ---- one repo: group and age ---------------------------------------------------------------------------------

// times: {head, index, files} in ms: .git/logs/HEAD (commit, checkout, pull), .git/index, newest changed tracked file.
// changed: when tracked changes were last touched; at: when the repo was.
// ponytail: the index time is only the fallback (staged deletions): other tools' `git status` rewrites the index.
export function touched(s, times = {}) {
  const changed = s?.tracked ? (times.files || times.index || null) : null;
  return { changed, at: Math.max(times.head || 0, changed || 0) || null };
}

// Commits that exist only here: ahead of upstream, or a branch never pushed in a repo that has a remote
// (s.local: commits on no remote branch, from `git rev-list --count HEAD --not --remotes`).
export function unpushed(repo, s) {
  if (!s || s.error) return 0;
  if (s.ahead) return s.ahead;
  return !s.upstream && !s.detached && repo.hasRemote ? s.local || 0 : 0;
}

// Which list a repo is in, and why:
//   unpushed: commits only on this machine          week: tracked changes touched in the last `week` ms
//   older:    everything else that is not clean, with a reason      clean: nothing to say (only under "All")
export function classify(repo, s, times, now, week = 7 * DAY) {
  if (!s) return { group: "pending", at: null };
  const { changed, at } = touched(s, times);
  if (s.error) return { group: "older", reason: "error", at };
  if (unpushed(repo, s)) return { group: "unpushed", at };
  if (s.tracked && changed && now - changed <= week) return { group: "week", at };
  if (s.tracked) return { group: "older", reason: "older", at };
  if (s.untracked) return { group: "older", reason: "untracked", at };
  if (s.behind) return { group: "older", reason: "behind", at };
  if (s.stash) return { group: "older", reason: "stash", at };
  if (!repo.hasRemote) return { group: "older", reason: "local", at };
  return { group: "clean", at };
}

const byAge = (a, b) => (b.c.at ?? 0) - (a.c.at ?? 0) || a.repo.path.localeCompare(b.repo.path);

// The lists of one view (repos already filtered by context), each sorted by age, newest first.
export function groups(repos, info, times, now, week = 7 * DAY) {
  const g = { unpushed: [], week: [], older: [], clean: [], pending: [] };
  for (const repo of repos) {
    const s = info[repo.path] ?? null, c = classify(repo, s, times[repo.path], now, week);
    g[c.group].push({ repo, s, c });
  }
  for (const k of Object.keys(g)) g[k].sort(byAge);
  return g;
}

// A repo and its worktrees are one family: [[repo path, rows]], families in the order of their first row (so
// by their newest checkout); in a family the repo itself first, then its worktrees as they came.
export const family = (repo) => repo.main ?? repo.path;
export function families(list) {
  const by = new Map();
  for (const x of list) (by.get(family(x.repo)) ?? by.set(family(x.repo), []).get(family(x.repo))).push(x);
  return [...by].map(([key, rows]) => [key, [...rows.filter((x) => x.repo.path === key), ...rows.filter((x) => x.repo.path !== key)]]);
}

// "Not pushed" counts repos: a repo with twelve unpushed worktrees is one thing to look at. The other two count rows.
export const weekWords = (days = 7) => (days === 7 ? "this week" : `in ${days} days`);
export const sentence = (g, days = 7) => `${families(g.unpushed).length} not pushed · ${g.week.length} changed ${weekWords(days)} · ${g.older.length} older`;

const WHY = [["older", (days) => `older than ${days} days`], ["untracked", () => "untracked only"], ["behind", () => "behind only"], ["stash", () => "stash only"], ["local", () => "no remote"], ["error", () => "git error"]];
// The folded group's line: "84 older than 7 days · 20 behind only · 10 no remote".
export function olderWhy(rows, days = 7) {
  return WHY.map(([k, label]) => [rows.filter((x) => x.c.reason === k).length, label(days)]).filter(([n]) => n).map(([n, label]) => `${n} ${label}`).join(" · ");
}

// How many repos have commits only here: {total, contexts: {id: n}, none}. A repo and its worktrees count once
// (per context); `none` are those of no context.
export function counts(repos, info) {
  const out = { total: 0, contexts: {}, none: 0 }, seen = new Set(), all = new Set();
  for (const repo of repos) {
    if (!unpushed(repo, info[repo.path])) continue;
    const key = `${repo.context ?? ""}|${family(repo)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (repo.context) out.contexts[repo.context] = (out.contexts[repo.context] ?? 0) + 1; else out.none++;
    if (!all.has(family(repo))) { all.add(family(repo)); out.total++; }
  }
  return out;
}

// "5 m", "2 h", "3 d", "5 w", "8 mo", "2 y"; "" when unknown.
export function age(at, now) {
  if (!at) return "";
  const m = Math.max(0, now - at) / 60000;
  if (m < 1) return "now";
  if (m < 60) return `${Math.floor(m)} m`;
  if (m < 60 * 24) return `${Math.floor(m / 60)} h`;
  const d = m / (60 * 24);
  if (d < 14) return `${Math.floor(d)} d`;
  if (d < 60) return `${Math.floor(d / 7)} w`;
  if (d < 365) return `${Math.floor(d / 30)} mo`;
  return `${Math.floor(d / 365)} y`;
}

export const cap = (n, max = 99) => (n > max ? `${max}+` : String(n));

// Names that more than one of these rows carries: those rows also say their folder.
export function twins(rows) {
  const seen = new Map();
  for (const { repo } of rows) seen.set(repo.name, (seen.get(repo.name) ?? 0) + (repo.kind === "repo" ? 1 : 0));
  return new Set([...seen].filter(([, n]) => n > 1).map(([name]) => name));
}

// Which repos have a space: folders: [{id, paths}] (a space's folder and its terminals' folders) -> Map(repo path -> space id).
export function spaceRepos(paths, folders) {
  const out = new Map();
  for (const { id, paths: ps } of folders) {
    for (let p of ps) {
      for (; p && p !== "/"; p = p.slice(0, p.lastIndexOf("/"))) if (paths.has(p)) { if (!out.has(p)) out.set(p, id); break; }
    }
  }
  return out;
}

// ---- pull requests, as providers publish them (nothing is fetched here) -----------------------------------------

const RANK = { open: 0, draft: 0, merged: 1, closed: 2 };

// A provider's commands for one PR: every "{url}", "{repo}", "{number}", "{branch}" in the strings filled in.
const fill = (v, pr) => (typeof v === "string" ? v.replace(/\{(url|repo|number|branch)\}/g, (_m, k) => String(pr[k] ?? ""))
  : Array.isArray(v) ? v.map((x) => fill(x, pr)) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fill(x, pr)])) : v);

// docs: what each provider published, {at, run, prs: [{repo: "owner/name", branch, number, state, url, base,
// headSha, updatedAt, run}]}. Gives {at, by: Map("owner/name" -> Map(branch -> pr))}; at: the oldest provider's
// time (the marks are at least that fresh). Of several PRs from one branch: the open one, else the one updated
// last. A PR's `run` is its own, else its provider's (a template with placeholders), else null.
export function prIndex(docs) {
  const by = new Map();
  let at = null;
  for (const doc of docs ?? []) {
    if (!Array.isArray(doc?.prs)) continue;
    if (Number.isFinite(doc.at)) at = at === null ? doc.at : Math.min(at, doc.at);
    for (const p of doc.prs) {
      if (!p || typeof p.repo !== "string" || typeof p.branch !== "string" || !p.branch || !Number.isFinite(+p.number)) continue;
      const pr = { repo: p.repo, number: +p.number, state: p.state in RANK ? p.state : "unknown", branch: p.branch, base: p.base ?? null, headSha: p.headSha ?? null,
        url: typeof p.url === "string" ? p.url : null, updatedAt: typeof p.updatedAt === "string" ? p.updatedAt : "" };
      pr.run = Array.isArray(p.run) ? p.run : Array.isArray(doc.run) ? fill(doc.run, pr) : null;
      const heads = by.get(p.repo) ?? by.set(p.repo, new Map()).get(p.repo);
      const old = heads.get(p.branch);
      const rank = (x) => RANK[x.state] ?? 3;
      if (!old || rank(pr) < rank(old) || (rank(pr) === rank(old) && pr.updatedAt > old.updatedAt)) heads.set(p.branch, pr);
    }
  }
  return { at, by };
}
// The PR of a branch. Never for the PR's own base (a branch named like the base is not that PR's work).
export function prFor(index, slug, branch) {
  const pr = slug && branch ? index?.by.get(slug)?.get(branch) ?? null : null;
  return pr && pr.base !== branch ? pr : null;
}
export const prLabel = (pr) => `#${pr.number}${pr.state === "unknown" ? "" : ` ${pr.state}`}`;

// ---- the branch card, from one `git for-each-ref` ---------------------------------------------------------------

export const REF_FORMAT = ["%(refname:short)", "%(objectname)", "%(upstream:short)", "%(upstream:track)", "%(worktreepath)", "%(committerdate:unix)", "%(HEAD)"].join("%1f");
// With the distance to the base branch: only valid when that branch exists (git fails otherwise).
export const refFormat = (base) => `${REF_FORMAT}%1f%(ahead-behind:${base})`;

// Base branches to try, in order: origin's default branch (from .git/refs/remotes/origin/HEAD), then the usual names.
export function baseCandidates(originHead) {
  const def = /^ref:\s*refs\/remotes\/origin\/(.+)$/m.exec(originHead ?? "")?.[1]?.trim();
  return [...new Set([def, "main", "master"].filter(Boolean).flatMap((b) => [b, `origin/${b}`]))];
}

// Rows of the card: the base first, then branches newest first, a branch whose PR targets another local branch
// right under that one (depth + 1: a stack).
//   ahead/behind: against its upstream; gone: the upstream was deleted; mainAhead/mainBehind: against `base`
//   canGo: "merged, can go", only with proof: its PR is merged and the branch still is that PR's head, or the
//   upstream is gone. Ancestry is not proof (a squash merge leaves the branch unmerged by ancestry).
export function branchCard(out, { base = null, prs = null, here = null } = {}) {
  const rows = [];
  for (const line of out.split("\n")) {
    if (!line) continue;
    const [name, oid, upstream, track, worktree, date, head, ab] = line.split("\x1f");
    const pr = prs?.get(name) ?? null;
    const [mainAhead, mainBehind] = (ab ?? "").split(" ").map(Number);
    const isBase = name === base || `origin/${name}` === base;
    const gone = track === "[gone]";
    rows.push({
      name, oid, isBase, upstream: upstream || null, gone,
      ahead: +(/ahead (\d+)/.exec(track)?.[1] ?? 0), behind: +(/behind (\d+)/.exec(track)?.[1] ?? 0),
      worktree: worktree && worktree !== here && head !== "*" ? worktree : null, // checked out in another folder
      current: head === "*",
      at: +date * 1000 || null,
      mainAhead: ab ? mainAhead : null, mainBehind: ab ? mainBehind : null,
      pr: pr && pr.base !== name ? pr : null,
      canGo: !isBase && (gone || Boolean(pr && pr.base !== name && pr.state === "merged" && (!pr.headSha || pr.headSha === oid))),
      depth: 0,
    });
  }
  const names = new Set(rows.map((r) => r.name));
  const parent = (r) => (r.pr?.base && names.has(r.pr.base) && r.pr.base !== r.name && !rows.find((x) => x.name === r.pr.base)?.isBase ? r.pr.base : null);
  const top = rows.filter((r) => !parent(r)).sort((a, b) => Number(b.isBase) - Number(a.isBase) || (b.at ?? 0) - (a.at ?? 0) || a.name.localeCompare(b.name));
  const ordered = [];
  const add = (r, depth) => {
    if (ordered.includes(r)) return; // a loop of bases: each branch once
    r.depth = depth; ordered.push(r);
    rows.filter((c) => parent(c) === r.name).sort((a, b) => (b.at ?? 0) - (a.at ?? 0)).forEach((c) => add(c, depth + 1));
  };
  top.forEach((r) => add(r, 0));
  rows.forEach((r) => add(r, 0)); // whatever a loop left out
  return ordered;
}

// Width of one side of a branch's bar: 0 for nothing, then a log scale (1 commit is visible, 60 fill it).
export const barPx = (n, full = 36) => (n > 0 ? Math.max(3, Math.round(Math.min(1, Math.log2(n + 1) / 6) * full)) : 0);

// Which repos get a watch on their git folder. Herdr watches at most 64 folders for all mods together, so this mod
// asks for few: the checkouts in use (`order`: their paths, the most used first), a repo once for all its
// worktrees, never more than `max`. Gives the paths to watch; whatever is watched and not among them is cancelled.
export function watchPlan(repos, order, max) {
  const by = new Map(repos.map((r) => [r.path, r])), out = new Set();
  for (const p of order) {
    const r = by.get(p);
    if (!r) continue;
    const key = r.main && by.has(r.main) ? r.main : r.path; // a worktree is covered by its repo's .git when that is listed
    if (out.has(key)) continue;
    if (out.size >= max) break;
    out.add(key);
  }
  return [...out];
}

// ---- the window and Go to ---------------------------------------------------------------------------------------

// Is a block showing this mod on screen: in the layout, no hidden ancestor, and the shown child of every stack above it.
export function blockShown(node, mod, up = true) {
  if (!node) return false;
  const here = up && node.hidden !== true;
  if (node.content?.mod === mod && here) return true;
  return (node.children ?? []).some((c) => blockShown(c, mod, here && (node.type !== "stack" || node.active === c.id)))
    || (node.floating ?? []).some((c) => blockShown(c, mod, here));
}

// Rows for Go to (its PROVIDERS.md, "Items"): the checkouts that need a look, each going to its space or opening one.
export function gotoItems(g, spaceOf, max = 40) {
  const item = (tag) => ({ repo, s }) => {
    const n = unpushed(repo, s), space = spaceOf.get(repo.path);
    return {
      id: repo.path, title: `${repo.name}${s?.branch ? ` · ${s.branch}` : ""}`,
      subtitle: [n ? `${n} not pushed` : "", s?.tracked ? `${s.tracked} changed` : ""].filter(Boolean).join(" · "),
      keywords: [repo.slug, s?.branch].filter(Boolean), tag, ...(repo.context ? { context: repo.context } : {}),
      ...(space ? { focus: { space } } : { run: [["space.new", { folder: repo.path, machine: "" }]] }),
    };
  };
  return [...g.unpushed.map(item("Not pushed")), ...g.week.map(item("Changed"))].slice(0, max);
}
