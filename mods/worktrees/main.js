// Where is work that exists only on this machine, or that I started? Three lists over every git checkout under the
// configured roots and the agents' worktrees (model.js configOf): Not pushed, Changed this week, Older or untracked
// only (folded). Local only: never fetches, never writes to a repo. A row's click: its space, or a new one there;
// its ▸ opens the branch card (one `git for-each-ref` for that repo).
// Starting a process is the expensive part (a quarter of a second each on some machines), so git is asked as rarely
// as possible: probe.py reads what changed from files, one process for many checkouts, and `git status` runs only
// for a checkout whose fingerprint differs from the one of its last git status (kept across app starts).
// Optional, through shared state only (PROVIDERS.md): contexts from "goto.context", PR marks from providers,
// rows in Go to; it publishes how many repos are not pushed.
import { View, div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme, shared, setShared, exec, home, appHome, run, focused, layout, props, settings, spaces, panes, openOverlay, watchFolder, readTextFile, nextCommand } from "herdr";
import { NAME } from "./name.js";
import { key, prsNow, openPr, prWhere, spaceMap, openFolder } from "./hub.js";
import History from "./history.js";
import { parse } from "./status.js";
import * as M from "./model.js";
import { middle } from "./graph.js";

const PARALLEL = 8;
const RESCAN_MS = 30 * 60 * 1000;
// All checkouts are checked when the panel opens and on ↻. While it stays open, every STATUS_MS only the ones in
// use: with a space or a terminal in them, or with files changed lately. A watch on each .git reports commits,
// checkouts, staging and pushes right away.
const STATUS_MS = 5 * 60 * 1000;
const TICK_MS = 10 * 1000;  // how often the panel looks whether it is shown (a layout lookup, no process)
const WATCH_MS = 1500;      // .git changes are collected this long, then checked together
const WATCH_MAX = 32;       // Herdr watches at most 64 folders for all mods together: this mod takes half, for the repos in use
const INDEX_MS = 60 * 1000; // … but when only the index file moved (staging, or another tool's git status): this long
const PROBES = 4;           // a full pass runs up to this many probes side by side, so the list fills in parts
const PROBE_MIN = 40;       // … but not for fewer checkouts than this each
const SHOW = [["needs", "Needs me"], ["all", "All"]];
// Narrower than this (content px): no age, no context word, no group hints. The branch always stays.
const COMPACT_PX = 300;
const WEEK_ROWS = 8;   // "Changed this week" shows this many, then "Show n more"
const FAMILY_ROWS = 3; // "Not pushed" shows this many checkouts of one repo, then "Show n more of <repo>"
const CARD_ROWS = 30;  // ponytail: a branch card lists the base and the newest branches; the rest is one count
const STAT_CHUNK = 600; // only without python3 (see ages)
const GIT = ["--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--porcelain=v2", "--branch", "--show-stash", "-z"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// On screen: opened as an overlay (mod.open), or a block of a layout that is not hidden and up in its stack.
const shownNow = () => Boolean(props()?.overlay) || M.blockShown(layout(), NAME);
const hhmm = (ms) => new Date(ms).toTimeString().slice(0, 5);
// "10:05", or "Nov 14 10:05" when that was not today.
const stamp = (ms) => { const d = new Date(ms); return d.toDateString() === new Date().toDateString() ? hhmm(ms) : `${MONTHS[d.getMonth()]} ${d.getDate()} ${hhmm(ms)}`; };
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const tilde = (path) => (path.startsWith(`${home()}/`) ? `~${path.slice(home().length)}` : path);
const color = (t, name) => (name ? t[name] ?? name : t.dim); // a theme color name or #hex

export default class Worktrees extends View {
  init(_props, cx) {
    // A copy opened with props {history: <checkout path>, …} is the history view of that checkout (history.js).
    if (props()?.history) { this.hist = new History(props(), cx); return; }
    if (shared(key("api"))?.version !== 1) setShared(key("api"), { version: 1 });
    this.cfg = M.configOf(null, home());
    this.show = localStorage.getItem("show") === "all" ? "all" : "needs";
    this.info = {};          // path -> parsed status (+ local: commits on no remote), or {error}
    this.times = {};         // path -> {head, index, files, fetch} in ms
    this.fp = {};            // path -> the probe's fingerprint when git status last ran there
    this.local = new Map();  // path -> {key, n}: the never-pushed count, kept while HEAD and the remote refs stay
    this.flagged = new Set(); // checkouts whose .git changed, waiting for the next check
    this.slow = new Set();    // the same, when only their index file changed: checked once a minute
    this.bases = new Map();  // common git dir -> the base branch its card last used
    this.watched = new Map(); // path -> the folder watched for it
    this.prs = M.prIndex(null); // from providers, see prsNow
    this.spaceOf = new Map();
    this.famOpen = new Set(); // repos whose unpushed worktrees are all listed
    this.open = null;        // path of the row whose branch card is open
    this.card = null;        // {path, base, rows}
    this.checked = 0; this.total = 0;
    let cache = null, state = null;
    try { cache = JSON.parse(localStorage.getItem("repos") ?? "null"); } catch {}
    try { state = JSON.parse(localStorage.getItem("state") ?? "null"); } catch {}
    this.setRepos(cache?.v === 1 ? cache.repos ?? [] : []);
    this.scannedAt = cache?.v === 1 ? cache.at ?? 0 : 0;
    // What was known when the app last ran: shown at once, and checked against the files before git is asked.
    if (state?.v === 1) {
      for (const [path, row] of Object.entries(state.rows ?? {})) {
        if (!this.byPath.has(path)) continue;
        this.info[path] = row.s; this.times[path] = row.t ?? {}; this.fp[path] = row.fp ?? null;
        if (row.local) this.local.set(path, row.local);
      }
      this.fullAt = this.checkedAt = state.at ?? null;
    }
    cx.spawn(async (cx) => {
      await this.loadConfig();
      // The remembered list serves for RESCAN_MS, unless the settings say to look elsewhere now.
      if (!this.repos.length || Date.now() - this.scannedAt > RESCAN_MS || cache?.where !== this.where()) await this.scan(cx);
      else this.watchAll(cx);
      await this.pass(cx, "full");
    });
    // In the background a rescan only checks checkouts it has not seen yet.
    cx.timer.every(RESCAN_MS, (cx) => cx.spawn(async (cx) => {
      await this.scan(cx);
      if (shownNow()) await this.pass(cx, "full");
      else await this.pass(cx, "new", this.repos.filter((r) => !this.info[r.path]).map((r) => r.path));
      this.publish(true); // still counting: a reader can drop a number nobody has confirmed for a while
    }));
    // While shown: the checkouts in use every STATUS_MS. While hidden: nothing, but remember it (render is not
    // called then), so that opening the panel checks all of them.
    cx.timer.every(TICK_MS, (cx) => {
      if (!shownNow()) this.away = true;
      else if (this.tickAt && Date.now() - this.tickAt > STATUS_MS) cx.spawn((cx) => this.pass(cx, "tick", this.inUse()));
    });
    cx.timer.every(INDEX_MS, (cx) => {
      if (!this.slow.size) return;
      for (const p of this.slow) this.flagged.add(p);
      this.slow.clear();
      cx.spawn((cx) => this.flush(cx));
    });
    // Commands, for keys.json ("<mod>.<command>"): show:needs|all, expand:<repo>, older, more, family:<repo>,
    // open:<repo>, pr:<repo>, history:<repo>, refresh, refresh:all (ask git for every checkout), tick.
    // <repo>: a checkout's path, its path below its root, or its name.
    cx.spawn(async (cx) => { for (;;) { this.command(String(await nextCommand()), cx); cx.notify(); } });
  }

  // The last copy going (removed, quit): no rows in Go to that nobody would keep fresh.
  async close() {
    if (!this.hist && shared(`goto.items.${NAME}`)) setShared(`goto.items.${NAME}`, null);
  }

  setRepos(repos) {
    this.repos = repos;
    this.byPath = new Map(repos.map((r) => [r.path, r]));
    this.ctxSig = null;
  }

  // Each checkout's context from the hook another mod may publish (shared "goto.context"); worked out again only
  // when the hook's folders or remotes changed. Without a hook: no contexts.
  contexts() {
    const hook = shared("goto.context") ?? null, sig = JSON.stringify([hook?.folders ?? null, hook?.remotes ?? null]);
    if (sig !== this.ctxSig) { this.ctxSig = sig; for (const r of this.repos) r.context = M.contextOf(r, hook, home()); }
    return hook;
  }

  // PR marks from the providers (hub.js prsNow).
  prsNow() { return prsNow(this); }

  command(c, cx) {
    const [name, arg] = [c.split(":")[0], c.split(":").slice(1).join(":")];
    const hit = () => this.repos.find((r) => r.path === arg) ?? this.repos.find((r) => r.rel === arg) ?? this.repos.find((r) => r.name === arg) ?? null;
    if (name === "show" && SHOW.some(([k]) => k === arg)) this.setShow(arg);
    else if (name === "expand") this.toggle(hit()?.path ?? null, cx);
    else if (name === "older") this.olderOpen = !this.olderOpen;
    else if (name === "more") this.moreWeek = !this.moreWeek;
    else if (name === "family") { const r = hit(), key = r && M.family(r); if (key) { if (this.famOpen.has(key)) this.famOpen.delete(key); else this.famOpen.add(key); } }
    else if (name === "open") { const r = hit(); if (r) this.openSpace(r, cx); }
    else if (name === "pr") { const r = hit(), pr = r && M.prFor(this.prsNow(), r.slug, this.info[r.path]?.branch); if (pr) openPr(pr, cx); }
    else if (name === "history") { const r = hit(); if (r) this.history(r.path, cx); }
    else if (name === "refresh") this.refresh(cx, arg === "all");
    else if (name === "tick") cx.spawn((cx) => this.pass(cx, "tick", this.inUse())); // what the timer does every five minutes
  }

  setShow(k) { this.show = k; try { localStorage.setItem("show", k); } catch {} }

  // The settings: <app home>/<mod>.config.json, read before every scan.
  async loadConfig() {
    this.cfg = M.configOf(await readTextFile(`${appHome()}/${NAME}.config.json`).catch(() => null), home());
  }
  // What the scan depends on, to tell a remembered list from other settings.
  where() { const { roots, worktreeRoots, prune, depth, max } = this.cfg; return JSON.stringify([roots, worktreeRoots, prune, depth, max]); }

  // One find per root; stops at each .git (a folder, or a worktree's file) and skips hidden and pruned folders.
  // Then two small files per checkout, no process: `.git` when it is a file (worktree), and the config (remote, owner/repo).
  async scan(cx) {
    this.scanning = true; cx.notify();
    await this.loadConfig();
    const found = new Set();
    const prune = this.cfg.prune.flatMap((n) => ["-name", n, "-o"]);
    for (const root of [...this.cfg.roots, ...this.cfg.worktreeRoots]) {
      try {
        // A missing root or an unreadable folder makes find exit nonzero; take what it printed.
        const r = await exec("find", ["-H", root, "-maxdepth", String(this.cfg.depth), "(", ...prune, "(", "-name", ".*", "!", "-name", ".git", ")", ")", "-prune",
          "-o", "-name", ".git", "-print", "-prune"], { timeout: 60000 });
        for (const line of r.stdout.split("\n")) if (line.endsWith("/.git")) found.add(line.slice(0, -5));
      } catch (e) { console.log(`${NAME}: find ${root}: ${e}`); }
    }
    const paths = [...found].sort((a, b) => a.localeCompare(b)).slice(0, this.cfg.max);
    const repos = [];
    const queue = [...paths];
    await Promise.all(Array.from({ length: PARALLEL }, async () => {
      for (let path; (path = queue.shift());) {
        const gitText = await readTextFile(`${path}/.git`).catch(() => null); // null for a folder
        const d = M.describe(path, gitText, this.cfg);
        repos.push({ ...d, ...M.remoteOf(await readTextFile(`${d.common}/config`).catch(() => null)) });
      }
    }));
    this.setRepos(repos.sort((a, b) => a.path.localeCompare(b.path)));
    for (const k of Object.keys(this.info)) if (!this.byPath.has(k)) { delete this.info[k]; delete this.times[k]; delete this.fp[k]; this.local.delete(k); }
    this.scannedAt = Date.now();
    try { localStorage.setItem("repos", JSON.stringify({ v: 1, at: this.scannedAt, where: this.where(), repos: this.repos })); } catch {}
    this.scanning = false;
    this.watchAll(cx);
    cx.notify();
  }

  // What changed, from files alone (probe.py): one process for all these checkouts. Map(path -> its line).
  // Empty when python3 or the script is missing: then git is asked for every checkout, as if all had changed.
  async probe(paths) {
    const out = new Map();
    if (this.noProbe || !paths.length) return out;
    const args = paths.flatMap((p) => { const r = this.byPath.get(p); return r ? [r.path, r.gitdir, r.common] : []; });
    const r = await exec("python3", [`${appHome()}/mods/${NAME}/probe.py`, ...args], { timeout: 120000 }).catch(() => null);
    for (const line of (r?.stdout ?? "").split("\n")) { try { const row = JSON.parse(line); out.set(row.path, row); } catch {} }
    if (!out.size) { this.noProbe = true; console.log(`${NAME}: probe.py did not answer (python3 missing?): asking git for every checkout`); }
    return out;
  }

  // One `git status` for a checkout; a second process only for a branch that was never pushed and whose commit is
  // on no remote ref (how many commits are on no remote), asked once per HEAD and state of the remote refs.
  // seen: the probe's line for it, if any. Returns how many processes ran.
  async status(path, seen = null, again = false) {
    const repo = this.byPath.get(path);
    let s, runs = 1;
    try {
      const r = await exec("git", GIT, { cwd: path, timeout: 30000 });
      s = r.code === 0 ? parse(r.stdout) : { error: (r.stderr.trim().split("\n")[0] || `git ${r.code}`).slice(0, 120) };
    } catch (e) {
      // git did not answer (a timeout on a busy machine): what was known before stays, and a checkout nothing is
      // known about yet is asked once more at the end of the pass, rather than listed as an error.
      if (this.info[path] && !this.info[path].error) return runs;
      if (!again) return runs;
      s = { error: String(e).slice(0, 120) };
    }
    if (repo?.main && s.stash) s.stash = 0; // the stash belongs to the repo: shown there, not again at each of its worktrees
    if (!s.error && !s.upstream && !s.detached && repo?.hasRemote && s.oid && s.oid !== "(initial)") {
      const k = `${s.oid}|${seen?.remotes ?? ""}`, had = this.local.get(path);
      if (seen?.onRemote && seen.oid === s.oid) s.local = 0; // its commit is a remote branch's: nothing only here
      else if (had?.key === k) s.local = had.n;
      else {
        runs++;
        const r = await exec("git", ["rev-list", "--count", "HEAD", "--not", "--remotes"], { cwd: path, timeout: 30000 }).catch(() => null);
        s.local = r?.code === 0 ? +r.stdout.trim() || 0 : 0;
        if (r?.code === 0) this.local.set(path, { key: k, n: s.local });
      }
    }
    this.info[path] = s;
    this.fp[path] = seen?.fp ?? null; // what the files looked like just before: the same next time means no git
    return runs;
  }

  // File times without the probe (no python3): one `stat` for all these checkouts.
  async ages(paths) {
    const want = new Map(); // file -> [repo path, kind]
    for (const p of paths) {
      const repo = this.byPath.get(p);
      if (!repo) continue;
      want.set(`${repo.gitdir}/logs/HEAD`, [p, "head"]); want.set(`${repo.gitdir}/HEAD`, [p, "head"]);
      want.set(`${repo.gitdir}/index`, [p, "index"]); want.set(`${repo.common}/FETCH_HEAD`, [p, "fetch"]);
      for (const f of this.info[p]?.files ?? []) want.set(`${p}/${f}`, [p, "files"]);
    }
    const files = [...want.keys()], times = Object.fromEntries(paths.map((p) => [p, {}]));
    let runs = 0;
    // Missing files (a deleted one, no reflog) make stat exit nonzero; the lines it printed still count.
    const read = async (flags, chunk) => {
      runs++;
      const r = await exec("stat", [...flags, ...chunk], { timeout: 20000 }).catch(() => null);
      let hits = 0;
      for (const line of (r?.stdout ?? "").split("\n")) {
        const sp = line.indexOf(" "), hit = want.get(line.slice(sp + 1)), ms = +line.slice(0, sp) * 1000;
        if (hit && ms) { hits++; times[hit[0]][hit[1]] = Math.max(times[hit[0]][hit[1]] ?? 0, ms); }
      }
      return hits;
    };
    for (let i = 0; i < files.length; i += STAT_CHUNK) {
      const chunk = files.slice(i, i + STAT_CHUNK);
      // BSD stat (macOS) first; when it gives nothing, GNU stat (Linux), and that one from then on.
      if (!this.gnuStat && await read(["-f", "%m %N"], chunk)) continue;
      if (await read(["-c", "%Y %n"], chunk)) this.gnuStat = true;
    }
    Object.assign(this.times, times);
    return runs;
  }

  // The checkouts in use: with a space or a terminal in them, or with tracked changes or commits from the last day.
  // The ones with a space first, then the most recently touched.
  inUse() {
    const now = Date.now(), open = spaceMap(new Set(this.repos.map((r) => r.path)));
    const at = (r) => M.touched(this.info[r.path], this.times[r.path]).at ?? 0;
    return this.repos.filter((r) => open.has(r.path) || now - at(r) < M.DAY)
      .sort((a, b) => Number(open.has(b.path)) - Number(open.has(a.path)) || at(b) - at(a)).map((r) => r.path);
  }

  // Check checkouts. kind: "full" (all: panel opened, ↻), "tick" (the ones in use), "watch" (the ones whose .git
  // changed), "new" (not seen before). First the probe says which ones changed; git is asked only for those
  // (force: for every one). Rows update as each part comes in.
  async pass(cx, kind, only = null, force = false) {
    if (this.running) { // one pass at a time: a full one asked for meanwhile runs right after, .git changes stay flagged
      if (kind === "full") { this.fullWanted = true; this.forceWanted = this.forceWanted || force; }
      return;
    }
    const paths = only ?? this.repos.map((r) => r.path);
    if (!paths.length) return;
    this.running = true; this.checked = 0; this.total = paths.length;
    const started = Date.now();
    let runs = 0, asked = 0;
    try {
      cx.notify();
      const todo = [], seen = new Map();
      const parts = Math.max(1, Math.min(PROBES, Math.floor(paths.length / PROBE_MIN)));
      // Up to PARALLEL git processes at a time work through `todo`, starting as soon as the first part names changes.
      let active = 0;
      const workers = [];
      const git = async () => { for (let p; (p = todo.shift());) { const n = await this.status(p, seen.get(p)); runs += n; asked++; this.checked++; cx.notify(); } };
      const pump = () => { while (active < PARALLEL && todo.length) { active++; workers.push(git().finally(() => { active--; })); } };
      await Promise.all(Array.from({ length: parts }, async (_x, k) => {
        const chunk = paths.filter((_p, i) => i % parts === k);
        if (!this.noProbe) runs++;
        const lines = await this.probe(chunk);
        for (const p of chunk) {
          const row = lines.get(p), s = this.info[p];
          if (row) { seen.set(p, row); this.times[p] = row.t ?? {}; }
          if (!force && row?.fp && row.fp === this.fp[p] && s && !s.error) this.checked++; // as it was: git would say the same
          else todo.push(p);
        }
        cx.notify();
        pump();
      }));
      pump();
      await Promise.all(workers);
      for (const p of paths) if (!this.info[p]) { runs += await this.status(p, seen.get(p), true); asked++; } // the ones git did not answer for, one at a time
      if (this.noProbe) runs += await this.ages(paths);
    } finally { this.running = false; } // whatever fails, the next pass may start
    this.checkedAt = Date.now();
    if (kind === "full") { this.fullAt = this.sessionFull = this.checkedAt; this.watchAll(cx); } // now it is known which ones are in use
    if (kind === "full" || kind === "tick") this.tickAt = this.checkedAt; // watch checks in between do not put the tick off
    this.passes = { ...this.passes, [kind]: { checkouts: paths.length, starts: runs, git: asked, ms: Date.now() - started, at: this.checkedAt } };
    try { localStorage.setItem("pass", JSON.stringify(this.passes)); } catch {}
    this.save();
    this.publish();
    if (this.open && paths.includes(this.open)) this.loadCard(this.open, cx);
    cx.notify();
    // What came up meanwhile: a full pass someone asked for, or .git changes.
    if (this.fullWanted) { const f = Boolean(this.forceWanted); this.fullWanted = this.forceWanted = false; await this.pass(cx, "full", null, f); }
    else if (this.flagged.size) await this.flush(cx);
  }

  // Keep what is known, for the next app start: the list shows it at once, and git is asked only where files changed.
  save() {
    const rows = {};
    for (const r of this.repos) {
      const s = this.info[r.path];
      if (s && !s.error) rows[r.path] = { s, t: this.times[r.path] ?? {}, fp: this.fp[r.path] ?? null, local: this.local.get(r.path) ?? null };
    }
    try { localStorage.setItem("state", JSON.stringify({ v: 1, at: this.fullAt ?? null, rows })); } catch {}
  }

  // What other mods may read. shared "<mod>.count": how many repos have commits only here, {total, contexts,
  // none, at}; numbers only. `at` says the count is alive: this mod only counts once it was shown in this app
  // session, and a number from an earlier session would be a guess. With Go to installed: the checkouts that need
  // a look as its rows, those of the shown context only.
  publish(beat = false) {
    if (!this.sessionFull) return; // not before this session's first full pass: until then it is yesterday's number
    const hook = this.contexts();
    const n = M.counts(this.repos, this.info), { at: _at, ...old } = shared(key("count")) ?? {};
    if (beat || !this.beaten || JSON.stringify(n) !== JSON.stringify(old)) { this.beaten = true; setShared(key("count"), { ...n, at: Date.now() }); }
    if (!shared("goto.api")) return;
    const g = M.groups(M.inView(this.repos, hook), this.info, this.times, Date.now(), this.cfg.weekDays * M.DAY);
    const items = this.cfg.goto ? M.gotoItems(g, spaceMap(new Set(this.repos.map((r) => r.path)))) : null;
    if (items && !(shared("goto.providers") ?? []).includes(NAME)) setShared("goto.providers", [...(shared("goto.providers") ?? []), NAME]);
    if (JSON.stringify(items) !== JSON.stringify(shared(`goto.items.${NAME}`) ?? null)) setShared(`goto.items.${NAME}`, items);
  }

  // Re-check a repo when its .git changes: for the repos in use, at most WATCH_MAX of them (model.js watchPlan).
  // A worktree's git folder lies inside its repo's .git, so that repo's watch covers it (touch sorts the changes
  // out). Everything else is checked when the panel opens, on ↻ and, while in use, every five minutes.
  watchAll(cx) {
    for (const path of [...this.watched.keys()]) if (!this.byPath.has(path)) this.watched.delete(path); // gone: its loop ends at its next change
    for (const path of M.watchPlan(this.repos, this.inUse(), [...this.watched.keys()], WATCH_MAX)) {
      const r = this.byPath.get(path), dir = r.main ? r.gitdir : `${path}/.git`;
      this.watched.set(path, dir);
      cx.spawn(async (cx) => {
        while (this.watched.get(path) === dir) {
          let changed;
          try { changed = await watchFolder(dir); } catch { this.watched.delete(path); return; }
          if (this.watched.get(path) !== dir) return;
          await this.touch(path, dir, changed ?? [], cx);
          cx.notify();
        }
      });
    }
  }

  // A watched git folder changed: note which checkouts the changed paths belong to, and check them together a
  // moment later. Files under .git/worktrees/<name>/ are that worktree's own (index, HEAD, log); everything else is
  // the repo's. When remote refs moved (push, fetch), every worktree of the repo is ahead or behind against them too.
  async touch(path, dir, changed, cx) {
    const wt = (p) => /\/\.git\/worktrees\/([^/]+)/.exec(p)?.[1] ?? null;
    const names = new Set(changed.map(wt).filter(Boolean));
    const own = !changed.length || changed.some((p) => !wt(p));
    const remote = changed.some((p) => p === dir || p.includes("/refs/remotes/") || p.endsWith("/packed-refs") || p.endsWith("/FETCH_HEAD"));
    // Only index files moved: staging, or another tool's `git status` refreshing it (some do that every few
    // seconds). Neither changes what is pushed, so these wait for the once-a-minute round.
    const lazy = changed.length > 0 && changed.every((p) => /\/index(\.lock)?$/.test(p));
    const to = lazy ? this.slow : this.flagged;
    if (own) to.add(path);
    for (const r of this.repos) if (r.main === path && (remote || names.has(r.gitdir.slice(r.gitdir.lastIndexOf("/") + 1)))) to.add(r.path);
    if (lazy || this.flushing) return;
    this.flushing = true;
    cx.timer.after(WATCH_MS, (cx) => cx.spawn(async (cx) => { this.flushing = false; await this.flush(cx); }));
  }

  async flush(cx) {
    if (this.running || !this.flagged.size) return; // a running pass takes them when it ends
    const paths = [...this.flagged].filter((p) => this.byPath.has(p));
    this.flagged.clear();
    await this.pass(cx, "watch", paths);
  }

  // ↻: look for checkouts again and check all of them. force: ask git for every one, whatever the files say.
  refresh(cx, force = false) {
    cx.spawn(async (cx) => { await this.scan(cx); if (force) this.local.clear(); await this.pass(cx, "full", null, force); });
  }

  // Its space, or a new one there.
  openSpace(repo, cx) { openFolder(repo.path, repo.context, cx, this.spaceOf); }

  // The history view of a repo (history.js), with the checkout's branch picked: a tab of its own in the shown
  // space, or a window when there is no space to put a tab in. A history tab of this repo that is already open is
  // gone to instead (and told the branch), in whatever space it is.
  history(path, cx) {
    const repo = this.byPath.get(path);
    if (!repo) return;
    const branch = this.info[path]?.branch ?? null, root = this.byPath.get(M.family(repo)) ?? repo;
    // the tab's name tells which repo it is: the folder too when another repo has the same name
    const twin = this.repos.some((r) => r.name === repo.name && M.family(r) !== M.family(repo));
    const title = `History · ${twin ? root.rel : repo.name}`;
    const mine = new Set(panes().filter((p) => p.mod === NAME).map((p) => p.tab));
    for (const s of spaces()) {
      const tab = s.tabs.find((x) => x.name === title && mine.has(x.id));
      if (!tab) continue;
      run("space.select", { id: s.id }); run("tab.select", { id: tab.id });
      if (branch) cx.timer.after(300, () => run(`${NAME}.h-pick:${branch}`));
      return;
    }
    const p = { history: path, name: repo.name, branch, slug: repo.slug ?? null, context: repo.context ?? null };
    if (focused()?.space) run("tab.new", { name: title, mod: NAME, props: p });
    else openOverlay({ mod: NAME, kind: "window", key: `${NAME}.history`, width: 980, height: 680, props: p });
  }

  toggle(path, cx) {
    this.open = this.open === path ? null : path;
    this.card = null;
    if (this.open) this.loadCard(this.open, cx);
  }

  // Branches of one repo: one `git for-each-ref` (a second or third only when the first base branch does not exist).
  loadCard(path, cx) {
    cx.spawn(async (cx) => {
      const repo = this.byPath.get(path);
      if (!repo) return;
      const args = (format) => ["for-each-ref", "refs/heads", `--format=${format}`];
      const head = await readTextFile(`${repo.common}/refs/remotes/origin/HEAD`).catch(() => null);
      let out = null, base = null;
      for (const b of [...new Set([this.bases.get(repo.common), ...M.baseCandidates(head)].filter(Boolean))]) {
        const r = await exec("git", args(M.refFormat(b)), { cwd: path, timeout: 20000 }).catch(() => null);
        if (r?.code === 0) { out = r.stdout; base = b; this.bases.set(repo.common, b); break; }
      }
      if (out === null) { const r = await exec("git", args(M.REF_FORMAT), { cwd: path, timeout: 20000 }).catch(() => null); if (r?.code === 0) out = r.stdout; }
      if (this.open !== path) return;
      this.card = { path, base, rows: out === null ? null : M.branchCard(out, { base, prs: this.prsNow().by.get(repo.slug) ?? null, here: path }) };
      cx.notify();
    });
  }

  // ---- drawing ---------------------------------------------------------------------------------------------------

  prMark(id, pr, t) {
    this.prShown = true;
    const tone = { open: t.ansi2, draft: t.muted, merged: t.ansi5, closed: t.dim }[pr.state] ?? t.muted;
    return div().id(id).flex_none().px(4).rounded(4).text_color(tone).hover((s) => s.bg(t.selected))
      .tooltip(`Pull request ${pr.repo}#${pr.number} (${pr.state})${this.prs.at ? `, as of ${stamp(this.prs.at)}` : ""}. Click: ${prWhere(pr)}.`)
      .on_click((_e, cx) => { cx.stop_propagation(); openPr(pr, cx); }).child(M.prLabel(pr));
  }

  marks(x, t) {
    const { repo, s } = x, n = M.unpushed(repo, s), out = [];
    if (!s) return [[t.dim, "…", "Git status not checked yet."]];
    if (s.error) return [[t.blocked, "Error", s.error]];
    if (n) out.push([t.ansi3, `↑${M.cap(n)}`, s.ahead ? `${plural(n, "commit")} not pushed to ${s.upstream}.` : `${plural(n, "commit")} on a branch that was never pushed.`, true]);
    if (s.behind) { const f = this.times[repo.path]?.fetch; out.push([t.dim, `↓${M.cap(s.behind)}`, `${plural(s.behind, "upstream commit")} not pulled, as of the last fetch${f ? ` (${M.age(f, Date.now())} ago)` : ""}.`]); }
    if (s.tracked) out.push([t.foreground, `●${M.cap(s.tracked)}`, `${plural(s.tracked, "changed tracked file")}.`]);
    if (s.untracked) out.push([t.dim, `?${M.cap(s.untracked)}`, `${plural(s.untracked, "untracked file or folder")}.`]);
    if (s.stash) out.push([t.muted, `⚑${M.cap(s.stash)}`, `${s.stash} stash ${s.stash === 1 ? "entry" : "entries"}.`]);
    return out;
  }

  // A checkout. two: the name on its own line (never cut, it wraps), then branch · PR · age · context. Otherwise one
  // line (folded group, "All"): name, then branch · PR · age in a narrow slot.
  row(x, t, { two, label, twin }) {
    const { repo, s, c } = x, path = repo.path, open = this.open === path, now = Date.now();
    const pr = M.prFor(this.prs, repo.slug, s?.branch);
    const spaceId = this.spaceOf.get(path);
    const dot = () => div().flex_none().text_color(t.dim).child("·");
    const word = (text, color = t.dim) => div().flex_none().text_color(color).child(text);
    const branch = s?.error ?? (s?.detached ? `detached ${(s.oid ?? "").slice(0, 7)}` : s?.branch ?? "");
    const facts = [
      two && repo.kind !== "repo" ? word(repo.kind === "agent" ? "agent worktree" : "worktree", t.ansi6) : null,
      // a long branch name loses its middle, so that both ends stay readable
      (two ? div().max_w(260) : div().min_w(0)).truncate().text_color(s?.error ? t.blocked : t.muted).child(two && !s?.error ? middle(branch, 38) : branch),
      two && s && !s.error && !s.upstream && M.unpushed(repo, s) ? word("never pushed", t.ansi3) : null,
      !repo.hasRemote ? word("no remote") : null,
      pr ? this.prMark(`pr-${path}`, pr, t) : null,
      two && twin && repo.kind === "repo" && repo.rel.includes("/") ? word(`in ${repo.rel.slice(0, repo.rel.lastIndexOf("/"))}`) : null,
      !this.compact && c.at ? word(M.age(c.at, now)) : null,
      two && !this.compact && !this.hook?.current && repo.context ? word(this.hook?.labels?.[repo.context] ?? repo.context, color(t, this.hook?.colors?.[repo.context])) : null,
    ].filter(Boolean);
    // Two-line rows wrap (a fact moves down with its dot) rather than cut the branch; the one-line slot cuts it.
    const line2 = h_flex().gap(5).items_center().text_size(11.5).min_w(0).when(Boolean(two), (e) => e.flex_wrap())
      .children(facts.map((f, i) => (i ? h_flex().flex_none().gap(5).items_center().child(dot()).child(f) : f)));
    const chevron = div().id(`x-${path}`).flex_none().size(24).flex().items_center().justify_center().rounded(5).text_size(11).text_color(t.muted)
      .hover((st) => st.bg(t.selected).text_color(t.foreground)).tooltip(open ? "Hide the branches." : "Show this repo's branches.")
      .accessibility_label(open ? "Hide branches" : "Show branches")
      .on_click((_e, cx) => { cx.stop_propagation(); this.toggle(path, cx); cx.notify(); }).child(open ? "▾" : "▸");
    const space = spaceId ? div().id(`sp-${path}`).flex_none().text_size(13).text_color(t.accent).tooltip("A space is open on this repo. Click: go there.").child("◧") : null;
    const tags = h_flex().flex_none().gap(6).items_center().children(this.marks(x, t).map(([color, text, tip, strong], i) =>
      div().id(`t-${path}-${i}`).flex_none().text_size(11.5).text_color(color).when(Boolean(strong), (e) => e.font_semibold()).tooltip(tip).child(text)));
    const name = div().flex_1().min_w(0).text_size(13).text_color(t.foreground).child(label);
    return v_flex().id(`r-${path}`).px(2).py(two ? 3 : 0).rounded(6).hover((st) => st.bg(t.hover))
      .tooltip(`${path} · ${spaceId ? "click: go to its space" : "click: open a space for it"}`)
      .on_click((_e, cx) => this.openSpace(repo, cx))
      .child(h_flex().gap(4).items_center().min_h(24).child(chevron).when(Boolean(space), (e) => e.child(space))
        .child(name).when(!two, (e) => e.child(line2.flex_none().max_w(170).overflow_hidden()))
        .child(tags))
      .when(two, (e) => e.child(line2.pl(28).pb(1)))
      .when(open, (e) => e.child(this.cardView(repo, t)));
  }

  // The branch card under an open row: every local branch against the base branch, as text and a small bar.
  cardView(repo, t) {
    const path = repo.path, card = this.card?.path === path ? this.card : null, now = Date.now();
    const link = (id, text, tip, click) => div().id(id).px(6).h(24).flex().items_center().rounded(5).text_size(11.5).text_color(t.muted)
      .hover((s) => s.bg(t.selected).text_color(t.foreground)).tooltip(tip).on_click((_e, cx) => { cx.stop_propagation(); click(cx); }).child(text);
    const foot = h_flex().gap(4).pt(2)
      .child(link(`hist-${path}`, "History ↗", "Open this repo's history as a drawn tree, in a tab of its own (or go to it when it is open).", (cx) => this.history(path, cx)))
      .child(link(`space-${path}`, "Open space ↗", "Go to this repo's space, or open one for it.", (cx) => this.openSpace(repo, cx)));
    const box = v_flex().id(`card-${path}`).ml(28).mr(4).mb(4).mt(2).p(6).gap(3).rounded(6).border(1).border_color(t.border).bg(t.surface)
      .on_click((_e, cx) => cx.stop_propagation()); // the card is not the row's "open space" target
    if (!card) return box.child(div().text_size(11.5).text_color(t.dim).child("Reading branches…")).child(foot);
    if (!card.rows) return box.child(div().text_size(11.5).text_color(t.blocked).child("git for-each-ref failed here.")).child(foot);
    const BAR = 36;
    const bar = (r) => h_flex().flex_none().items_center().w(BAR * 2 + 1).h(8)
      .child(h_flex().w(BAR).h(4).justify_end().child(div().w(M.barPx(r.mainBehind, BAR)).h(4).rounded(2).bg(t.dim)))
      .child(div().w(1).h(8).bg(t.border))
      .child(div().w(M.barPx(r.mainAhead, BAR)).h(4).rounded(2).bg(t.accent));
    const shown = card.rows.slice(0, CARD_ROWS);
    const one = (r, i) => {
      const dist = r.mainAhead === null || r.isBase ? "" : [r.mainAhead ? `↑${M.cap(r.mainAhead, 999)}` : "", r.mainBehind ? `↓${M.cap(r.mainBehind, 999)}` : ""].filter(Boolean).join(" ") || "=";
      const notes = [
        r.ahead ? div().flex_none().text_color(t.ansi3).font_semibold().child(`↑${M.cap(r.ahead)} not pushed`) : null,
        !r.upstream ? div().flex_none().text_color(t.dim).child("no upstream") : null,
        r.behind ? div().flex_none().text_color(t.dim).child(`↓${M.cap(r.behind)} to pull`) : null,
        r.pr ? this.prMark(`cpr-${path}-${i}`, r.pr, t) : null,
        r.worktree ? div().id(`wt-${path}-${i}`).flex_none().text_color(t.ansi6).tooltip(`Checked out in ${r.worktree}`).child("⧉ worktree") : null,
        r.canGo ? div().id(`go-${path}-${i}`).flex_none().text_color(t.ansi2)
          .tooltip(r.pr?.state === "merged" ? `PR #${r.pr.number} is merged and this branch is still its head.` : "Its upstream branch is gone (deleted on the remote, seen by the last fetch with prune).")
          .child("merged, can go") : null,
      ].filter(Boolean);
      return v_flex().pl(r.depth * 12)
        .child(h_flex().gap(6).items_center().min_h(18)
          .child(div().id(`b-${path}-${i}`).flex_1().min_w(0).truncate().text_size(12).text_color(r.current ? t.foreground : t.muted).when(r.current, (e) => e.font_semibold())
            .tooltip(`${r.name}${r.current ? " (checked out here)" : ""}${r.isBase ? " · the base the bars compare to" : ""}`)
            .child(`${r.depth ? "└ " : ""}${r.name}`))
          .when(r.mainAhead !== null && !r.isBase, (e) => e.child(bar(r)))
          .child(div().flex_none().w(62).text_size(11).text_color(t.dim).child(r.isBase ? "base" : dist))
          .child(div().flex_none().w(30).text_size(11).text_color(t.dim).child(M.age(r.at, now))))
        .when(notes.length > 0, (e) => e.child(h_flex().pl(10).gap(8).items_center().flex_wrap().text_size(11).children(notes)));
    };
    return box
      .child(div().text_size(10.5).text_color(t.dim).child(card.base ? `branches vs ${card.base.startsWith("origin/") ? card.base : `local ${card.base}`} · no fetch` : "branches · no main branch found"))
      .children(shown.map(one))
      .when(card.rows.length > shown.length, (e) => e.child(div().text_size(11).text_color(t.dim).child(`+${card.rows.length - shown.length} older branches`)))
      .child(foot);
  }

  render(cx) {
    if (this.hist) return this.hist.render(cx);
    const t = theme();
    const shown = shownNow();
    this.compact = (this.width ?? Infinity) < COMPACT_PX;
    // Opening the panel re-checks if the last pass is over a minute old. After this render: a pass notifies, and
    // notifying during render throws.
    if (shown && this.away) {
      this.away = false;
      if (this.fullAt && Date.now() - this.fullAt > 60000) cx.timer.after(0, (cx) => cx.spawn((cx) => this.pass(cx, "full")));
    }
    this.hook = this.contexts();
    this.prsNow();
    this.prShown = false;
    const days = this.cfg.weekDays;
    const mine = M.inView(this.repos, this.hook);
    const body = [];
    let g = null;
    if (shown) { // hidden: nothing below the header is worked out
      this.spaceOf = spaceMap(new Set(this.repos.map((r) => r.path)));
      g = M.groups(mine, this.info, this.times, Date.now(), days * M.DAY);
      const head = (id, text, hint) => h_flex().id(id).px(8).pt(10).pb(2).gap(8).items_center().justify_between().text_size(11)
        .child(div().flex_none().font_semibold().text_color(t.muted).child(text))
        .when(!this.compact && Boolean(hint), (e) => e.child(div().min_w(0).truncate().text_color(t.dim).child(hint)));
      const note = (text) => div().px(8).py(4).text_size(12).text_color(t.dim).child(text);
      if (this.show === "all") {
        const all = [...g.unpushed, ...g.week, ...g.older, ...g.clean, ...g.pending].sort((a, b) => a.repo.rel.localeCompare(b.repo.rel) || a.repo.path.localeCompare(b.repo.path));
        body.push(...all.map((x) => this.row(x, t, { two: false, label: x.repo.rel })));
        if (!all.length && this.repos.length) body.push(note("No checkouts in this context."));
      } else {
        const twins = M.twins([...g.unpushed, ...g.week, ...g.older]);
        const two = (x) => this.row(x, t, { two: true, label: x.repo.name, twin: twins.has(x.repo.name) });
        const more = (id, text, click) => div().id(id).ml(30).mr(8).px(6).h(24).flex().items_center().rounded(5).text_size(11.5).text_color(t.muted)
          .hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click((_e, cx) => { click(); cx.notify(); }).child(text);
        // Complete, but a repo with many unpushed worktrees shows its newest few and one line for the rest.
        const fams = M.families(g.unpushed);
        body.push(head("h-unpushed", fams.length === g.unpushed.length ? `NOT PUSHED (${fams.length})` : `NOT PUSHED (${plural(fams.length, "repo")}, ${plural(g.unpushed.length, "checkout")})`, "only on this machine"));
        for (const [key, rows] of fams) {
          const all = this.famOpen.has(key);
          body.push(...(all ? rows : rows.slice(0, FAMILY_ROWS)).map(two));
          if (rows.length > FAMILY_ROWS) body.push(more(`fam-${key}`, all ? "Show fewer" : `Show ${rows.length - FAMILY_ROWS} more of ${rows[0].repo.name}`,
            () => { if (all) this.famOpen.delete(key); else this.famOpen.add(key); }));
        }
        if (!g.unpushed.length) body.push(note(g.pending.length ? `Checking… ${plural(g.pending.length, "checkout")} to go.` : "Every commit is on a remote."));
        body.push(head("h-week", `CHANGED ${M.weekWords(days).toUpperCase()} (${g.week.length})`, `tracked files, last ${days} days`));
        const week = this.moreWeek ? g.week : g.week.slice(0, WEEK_ROWS);
        body.push(...week.map(two));
        if (g.week.length > WEEK_ROWS) body.push(more("week-more", this.moreWeek ? "Show fewer" : `Show ${g.week.length - WEEK_ROWS} more`, () => { this.moreWeek = !this.moreWeek; }));
        if (g.older.length) {
          body.push(v_flex().id("h-older").mt(8).px(8).py(4).gap(1).rounded(6).hover((s) => s.bg(t.hover))
            .tooltip(`Changes older than ${days} days, only untracked files, only behind, only a stash, or no remote at all.`)
            .on_click((_e, cx) => { this.olderOpen = !this.olderOpen; cx.notify(); })
            .child(div().min_h(18).text_size(11).font_semibold().text_color(t.muted).child(`${this.olderOpen ? "▾" : "▸"} OLDER OR UNTRACKED ONLY (${g.older.length})`))
            .child(div().pl(12).text_size(11).text_color(t.dim).child(M.olderWhy(g.older, days))));
          if (this.olderOpen) body.push(...g.older.map((x) => this.row(x, t, { two: false, label: x.repo.name })));
        }
      }
      // Nothing found at all: say where it looked and where to change that.
      if (!this.repos.length && !this.scanning) body.splice(0, body.length, note(`No git checkouts under ${this.cfg.roots.map(tilde).join(", ")}. Set "roots" in ${tilde(appHome())}/${NAME}.config.json, then ↻.`));
    }
    const seg = h_flex().flex_none().p(2).gap(2).rounded(7).border(1).border_color(t.border).bg(t.surface)
      .children(SHOW.map(([k, label]) => div().id(`seg-${k}`).px(8).h(24).flex().items_center().rounded(5).text_size(11.5)
        .tooltip(k === "needs" ? "Checkouts with commits that are not pushed, or with changes." : "Every checkout under the roots, by folder.")
        .bg(this.show === k ? t.selected : t.surface).text_color(this.show === k ? t.foreground : t.muted)
        .on_click((_e, cx) => { this.setShow(k); cx.notify(); }).child(k === "all" ? `All ${mine.length}` : label)));
    // "git as of": the last check of any kind; "(all 13:05)" when the last check of every checkout is older.
    const asOf = this.checkedAt ? `${hhmm(this.checkedAt)}${this.fullAt && this.checkedAt - this.fullAt > 60000 ? ` (all ${stamp(this.fullAt)})` : ""}` : "";
    const state = [this.scanning ? "looking for repos …" : this.running ? `checking ${this.checked}/${this.total} …` : "",
      asOf ? (this.prShown && this.prs.at ? `git as of ${asOf} · PRs as of ${stamp(this.prs.at)}` : `as of ${asOf} · local, no fetch`) : "",
      this.noProbe ? "no python3: slower checks" : ""].filter(Boolean).join(" · ");
    const last = this.passes?.full, pass = last ? ` Last check of all: ${plural(last.checkouts, "checkout")}, ${last.starts} ${last.starts === 1 ? "process" : "processes"} (git asked for ${last.git}), ${(last.ms / 1000).toFixed(1)} s.` : "";
    // the size comes in window px: divided by the zoom it is in the px this mod lays out with
    return v_flex().id("root").on_size_change((size, cx) => { this.width = size.width / (settings()?.zoom || 1); cx.notify(); }).size_full().min_h(0).bg(t.background).rounded(10).border(1).border_color(t.border).text_size(13)
      .child(v_flex().p(12).gap(8).border_b(1).border_color(t.border)
        .child(h_flex().gap(8).items_start().justify_between()
          .child(div().id("count").flex_1().min_w(0).tooltip(`Repos with commits only on this machine · checkouts with tracked changes from the last ${days} days · everything else that is not clean.`)
            .text_size(13).font_semibold().text_color(t.foreground).child(!this.repos.length ? (this.scanning ? "Looking for repos…" : "No repos yet") : g && (!g.pending.length || g.pending.length < mine.length) ? M.sentence(g, days) : "Checking repos…"))
          .child(div().id("refresh").flex_none().size(24).flex().items_center().justify_center().rounded(5).text_size(12).text_color(t.dim).hover((s) => s.bg(t.hover).text_color(t.foreground))
            .tooltip(`Look for checkouts again and check all of them. Shift-click: ask git for every one, whatever the files say. Local only: nothing is fetched.${pass}`).accessibility_label("Refresh repos")
            .on_click((e, cx) => this.refresh(cx, Boolean(e?.modifiers?.shift))).child(this.scanning || this.running ? "…" : "↻")))
        .child(h_flex().child(seg))
        .child(div().text_size(11).text_color(t.dim).child(state)))
      .child(v_flex().flex_1().min_h(0).p(6).gap(1).overflow_y_scrollbar().children(body));
  }
}
