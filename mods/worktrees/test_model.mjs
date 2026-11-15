// Run: node --test test_model.mjs   (invented data only)
import assert from "node:assert/strict";
import { parse } from "./status.js";
import * as M from "./model.js";

const H = "/u/me", NOW = Date.UTC(2026, 10, 15, 12), h = (n) => NOW - n * 3600000, d = (n) => NOW - n * M.DAY;

// ---- status.js
const st = parse(["# branch.oid abc", "# branch.head feat/y", "# branch.upstream origin/feat/y", "# branch.ab +3 -1", "# stash 2",
  "2 R. N... 100644 100644 100644 a b R100 new name.txt", "old.txt", "1 .M N... 100644 100644 100644 a b src/d.js",
  "u UU N... 100644 100644 100644 100644 a b c both.txt", "? untracked one", "? two", ""].join("\0"));
assert.deepEqual({ ...st, files: undefined }, { branch: "feat/y", oid: "abc", detached: false, upstream: "origin/feat/y", ahead: 3, behind: 1, tracked: 3, untracked: 2, stash: 2, files: undefined });
assert.deepEqual(st.files, ["new name.txt", "src/d.js", "both.txt"]); // the rename's old path is not a file of its own
assert.equal(parse("# branch.oid abc\0# branch.head (detached)\0").detached, true);
assert.equal(parse(Array.from({ length: 40 }, (_, i) => `1 .M N... 1 1 1 a b f${i}`).join("\0")).files.length, 12);

// ---- settings
const C0 = M.configOf(null, H);
assert.deepEqual(C0.roots, [`${H}/code`, `${H}/src`, `${H}/projects`, `${H}/dev`]);
assert.deepEqual(C0.worktreeRoots, [`${H}/.herdr/worktrees`]);
assert.deepEqual([C0.depth, C0.max, C0.weekDays, C0.goto], [4, 500, 7, true]);
const C1 = M.configOf('{"roots":["~/work","/srv/git","rel","/","~"],"worktreeRoots":[],"prune":["vendor","a/b"],"depth":99,"max":0,"weekDays":14,"goto":false}', H);
assert.deepEqual(C1, { roots: [`${H}/work`, "/srv/git", `${H}/rel`], worktreeRoots: [], prune: ["vendor"], depth: 8, max: 1, weekDays: 14, goto: false, editors: [], dryRun: false }); // never "/" or the home
assert.deepEqual(M.configOf("not json", H), C0);
assert.deepEqual(M.configOf('["a"]', H).roots, C0.roots);
assert.equal(M.rootOf(`${H}/codex/x`, C0.roots), null); // a prefix stops at "/"
assert.equal(M.rootOf("/a/b/c", ["/a", "/a/b"]), "/a/b"); // the nearest root

// ---- .git file, config
assert.deepEqual(M.gitLink(null, "/r/a"), { gitdir: "/r/a/.git", common: "/r/a/.git", main: null });
assert.deepEqual(M.gitLink("gitdir: /r/a/.git/worktrees/feat-x\n", "/w/a/feat-x"), { gitdir: "/r/a/.git/worktrees/feat-x", common: "/r/a/.git", main: "/r/a" });
assert.deepEqual(M.gitLink("gitdir: ../.git/modules/sub", "/r/a/sub"), { gitdir: "/r/a/.git/modules/sub", common: "/r/a/.git/modules/sub", main: null });
const CFG = '[core]\n\tbare = false\n[remote "fork"]\n\turl = https://example.org/me/fork.git\n[remote "origin"]\n\turl = https://github.com/acme/widgets.git\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n[branch "main"]\n\tremote = origin\n';
assert.deepEqual(M.remoteOf(CFG), { hasRemote: true, url: "https://github.com/acme/widgets.git", slug: "acme/widgets" });
assert.equal(M.remoteOf('[remote "origin"]\n url = ssh://git.example.org/acme/widgets\n').slug, null);
assert.equal(M.remoteOf('[remote "origin"]\n url = host.example.org:acme/widgets.git\n').slug, null);
assert.equal(M.remoteOf('[remote "o"]\n url = github.com:acme/widgets.git\n').slug, "acme/widgets"); // the scp-like form
assert.deepEqual(M.remoteOf("[core]\n\tbare = false\n"), { hasRemote: false, url: null, slug: null });
assert.deepEqual(M.remoteOf(null), { hasRemote: false, url: null, slug: null });

// ---- describe: kind, name, rel
const D = (path, git) => M.describe(path, git, C0);
assert.deepEqual((({ kind, name, rel }) => ({ kind, name, rel }))(D(`${H}/code/team/widgets`, null)), { kind: "repo", name: "widgets", rel: "team/widgets" });
const agentWt = D(`${H}/.herdr/worktrees/gadgets/feat-x`, `gitdir: ${H}/src/gadgets/.git/worktrees/feat-x`);
assert.deepEqual([agentWt.kind, agentWt.name, agentWt.main, agentWt.rel], ["agent", "gadgets", `${H}/src/gadgets`, "gadgets/feat-x"]);
assert.equal(D(`${H}/code/widgets-wt`, `gitdir: ${H}/code/widgets/.git/worktrees/widgets-wt`).kind, "worktree");
assert.equal(M.describe("/srv/git", null, { roots: ["/srv/git"], worktreeRoots: [] }).rel, "git"); // a root that is itself a repo

// ---- contexts (the hook: shared "goto.context")
const HOOK = { current: null, folders: [["~/code", "blue"], ["~/code/client", "red"]], remotes: [["github\\.com[:/]red-org/", "red"]], labels: { blue: "Blue", red: "Red" } };
const ctx = (repo) => M.contextOf(repo, HOOK, H);
assert.equal(ctx({ path: `${H}/code/widgets` }), "blue");
assert.equal(ctx({ path: `${H}/Code/Client/site` }), "red");                                   // the longest prefix wins, case-insensitive
assert.equal(ctx({ path: `${H}/.herdr/worktrees/site/a`, main: `${H}/code/client/site` }), "red"); // a worktree: its repo's
assert.equal(ctx({ path: "/srv/x", url: "https://github.com/red-org/x.git" }), "red");
assert.equal(ctx({ path: "/srv/x", url: "https://github.com/other/x.git" }), null);
assert.equal(M.contextOf({ path: `${H}/code/widgets` }, null, H), null);
assert.equal(M.contextOf({ path: "/srv/x", url: "u" }, { remotes: [["(", "red"]] }, H), null);  // a broken pattern matches nothing
const some = [{ path: "a", context: "blue" }, { path: "b", context: "red" }, { path: "c", context: null }];
assert.deepEqual(M.inView(some, { current: "red" }).map((r) => r.path), ["b"]);                 // nothing of another or of no context
assert.equal(M.inView(some, { current: null }).length, 3);
assert.equal(M.inView(some, null).length, 3);

// ---- classify
const repo = { path: "/r/a", hasRemote: true }, lonely = { path: "/r/b", hasRemote: false };
const S = (o) => ({ branch: "main", upstream: "origin/main", detached: false, ahead: 0, behind: 0, tracked: 0, untracked: 0, stash: 0, ...o });
const C = (r, s, t, week) => { const c = M.classify(r, s, t, NOW, week); return c.reason ? `${c.group}/${c.reason}` : c.group; };
assert.equal(C(repo, null), "pending");
assert.equal(C(repo, S({})), "clean");
assert.equal(C(repo, S({ ahead: 2 })), "unpushed");
assert.equal(C(repo, S({ ahead: 2, tracked: 5 }), { files: d(30) }), "unpushed"); // the risk wins over the age
assert.equal(C(repo, S({ upstream: null, local: 4 })), "unpushed");               // never pushed, own commits
assert.equal(C(repo, S({ upstream: null, local: 0 })), "clean");                  // a new branch without commits
assert.equal(C(repo, S({ upstream: null })), "clean");                            // not counted yet
assert.equal(C(repo, S({ upstream: null, detached: true, local: 4 })), "clean");
assert.equal(C(lonely, S({ upstream: null, local: 9 })), "older/local");          // no remote at all: not a finding
assert.equal(C(lonely, S({ upstream: null, tracked: 1 }), { files: h(2) }), "week");
assert.equal(C(repo, S({ tracked: 1 }), { files: d(6.9) }), "week");
assert.equal(C(repo, S({ tracked: 1 }), { files: d(7.1), index: h(1) }), "older/older"); // the file's time, not the index's
assert.equal(C(repo, S({ tracked: 1 }), { files: d(7.1) }, 14 * M.DAY), "week");  // weekDays: 14
assert.equal(C(repo, S({ tracked: 1 }), { index: h(1) }), "week");                // staged deletion: no file left to ask
assert.equal(C(repo, S({ tracked: 1 }), {}), "older/older");                      // age unknown: not "this week"
assert.equal(C(repo, S({ untracked: 1700 }), { head: h(1) }), "older/untracked");
assert.equal(C(repo, S({ behind: 12 })), "older/behind");
assert.equal(C(repo, S({ stash: 1 })), "older/stash");
assert.equal(C(repo, { error: "fatal: not a git repository" }), "older/error");
assert.equal(M.unpushed(repo, S({ upstream: null, local: 4 })), 4);
assert.equal(M.unpushed(repo, S({ ahead: 2, local: 4 })), 2);
assert.deepEqual(M.touched(S({ tracked: 1 }), { head: h(50), files: h(3) }), { changed: h(3), at: h(3) });
assert.deepEqual(M.touched(S({}), { head: h(50), files: h(3), index: h(1) }), { changed: null, at: h(50) });

// ---- groups, sentence, folded line
const repos = ["a", "b", "c", "d", "e", "f"].map((n) => ({ path: `/r/${n}`, name: n, kind: "repo", hasRemote: n !== "f" }));
const info = { "/r/a": S({ ahead: 1 }), "/r/b": S({ ahead: 3 }), "/r/c": S({ tracked: 2 }), "/r/d": S({ behind: 2 }), "/r/e": S({}), "/r/f": S({ upstream: null }) };
const times = { "/r/a": { head: d(3) }, "/r/b": { head: h(2) }, "/r/c": { files: h(5) }, "/r/d": { head: d(40) } };
const g = M.groups(repos, info, times, NOW);
assert.deepEqual(g.unpushed.map((x) => x.repo.name), ["b", "a"]); // newest first
assert.deepEqual([g.week.length, g.older.length, g.clean.length], [1, 2, 1]);
assert.equal(M.sentence(g), "2 not pushed · 1 changed this week · 2 older");
assert.equal(M.sentence(g, 14), "2 not pushed · 1 changed in 14 days · 2 older");
assert.equal(M.olderWhy(g.older), "1 behind only · 1 no remote");
assert.equal(M.olderWhy([{ c: { reason: "older" } }], 14), "1 older than 14 days");
assert.equal(M.sentence(M.groups([], {}, {}, NOW)), "0 not pushed · 0 changed this week · 0 older");
// a repo and its unpushed worktrees: one family, counted once
const fam = [{ path: "/r/a", name: "a", kind: "repo", hasRemote: true, context: "blue" }, { path: "/w/a/x", main: "/r/a", name: "a", kind: "agent", hasRemote: true, context: "blue" },
  { path: "/r/b", name: "b", kind: "repo", hasRemote: true, context: "red" }, { path: "/w/a/y", main: "/r/a", name: "a", kind: "agent", hasRemote: true, context: "blue" },
  { path: "/r/c", name: "c", kind: "repo", hasRemote: true, context: null }, { path: "/r/d", name: "d", kind: "repo", hasRemote: true, context: "red" }];
const famInfo = Object.fromEntries(fam.map((r) => [r.path, S({ ahead: r.name === "d" ? 0 : 1 })]));
const fg = M.groups(fam, famInfo, { "/w/a/y": { head: h(1) }, "/r/b": { head: h(2) }, "/r/a": { head: h(3) }, "/w/a/x": { head: h(4) }, "/r/c": { head: h(5) } }, NOW);
assert.deepEqual(M.families(fg.unpushed).map(([k, rows]) => [k, rows.map((x) => x.repo.path)]), [["/r/a", ["/r/a", "/w/a/y", "/w/a/x"]], ["/r/b", ["/r/b"]], ["/r/c", ["/r/c"]]]);
assert.equal(M.sentence(fg), "3 not pushed · 0 changed this week · 0 older");
assert.deepEqual(M.counts(fam, famInfo), { total: 3, contexts: { blue: 1, red: 1 }, none: 1 });
assert.deepEqual(M.counts([], {}), { total: 0, contexts: {}, none: 0 });

// ---- age, cap, twins, spaces
assert.deepEqual([h(0), NOW - 5 * 60000, h(2), d(1.5), d(13), d(15), d(70), d(800), null].map((t) => M.age(t, NOW)), ["now", "5 m", "2 h", "1 d", "13 d", "2 w", "2 mo", "2 y", ""]);
assert.deepEqual([M.cap(7), M.cap(99), M.cap(1717)], ["7", "99", "99+"]);
assert.deepEqual([...M.twins([{ repo: { name: "api", kind: "repo" } }, { repo: { name: "api", kind: "repo" } }, { repo: { name: "web", kind: "repo" } }, { repo: { name: "web", kind: "agent" } }])], ["api"]);
const sr = M.spaceRepos(new Set(["/r/a", "/r/a/nested", "/r/b"]), [{ id: "s1", paths: ["/r/a/src/x", ""] }, { id: "s2", paths: ["/r/a/nested"] }, { id: "s3", paths: ["/r/abc", "/elsewhere"] }]);
assert.deepEqual([...sr], [["/r/a", "s1"], ["/r/a/nested", "s2"]]);

// ---- PR data from providers
const prs = M.prIndex([{ at: 2000, prs: [
  { repo: "acme/widgets", number: 7, state: "merged", branch: "feat/x", base: "main", headSha: "old", updatedAt: "2026-10-01" },
  { repo: "acme/widgets", number: 9, state: "open", branch: "feat/x", base: "main", headSha: "x2", updatedAt: "2026-09-01" },   // reused branch: the open one
  { repo: "acme/widgets", number: "12", state: "draft", branch: "feat/y", base: "feat/x", headSha: "y1", run: [["layout.switch", { name: "review" }]] },
  { repo: "acme/widgets", number: 4, state: "weird", branch: "fix/odd", base: "main" },
  { repo: "acme/widgets", number: 3, state: "merged", branch: "main", base: "main" },
  { number: 2 }, null, { repo: "acme/widgets", branch: "", number: 1 }] },
  { at: 1000, prs: [{ repo: "acme/widgets", number: 5, state: "merged", branch: "fix/old", base: "main", headSha: "o1" }, { repo: "acme/other", number: 1, state: "open", branch: "feat/x", base: "main" }] },
  { prs: "nope" }, null]);
assert.equal(prs.at, 1000); // as fresh as the stalest provider
assert.equal(M.prFor(prs, "acme/widgets", "feat/x").number, 9);
assert.equal(M.prFor(prs, "acme/other", "feat/x").number, 1);
assert.equal(M.prFor(prs, "acme/widgets", "main"), null);
assert.equal(M.prFor(prs, null, "feat/x"), null);
assert.equal(M.prFor(prs, "acme/none", "feat/x"), null);
assert.deepEqual([M.prLabel(M.prFor(prs, "acme/widgets", "feat/y")), M.prLabel(M.prFor(prs, "acme/widgets", "fix/odd"))], ["#12 draft", "#4"]);
assert.deepEqual(M.prFor(prs, "acme/widgets", "feat/y").run, [["layout.switch", { name: "review" }]]);
assert.deepEqual([M.prIndex(null).at, M.prIndex([]).by.size], [null, 0]);
// a provider's `run` is a template for all its PRs; a PR's own run wins
const tpl = M.prIndex([{ at: 1, run: [["layout.show", { id: "panel" }], ["review.pick:{repo}#{number}", { url: "{url}", n: 3 }]], prs: [
  { repo: "acme/widgets", branch: "a", number: 5, url: "https://example.org/5" }, { repo: "acme/widgets", branch: "b", number: 6, run: [["x", {}]] }] }]);
assert.deepEqual(M.prFor(tpl, "acme/widgets", "a").run, [["layout.show", { id: "panel" }], ["review.pick:acme/widgets#5", { url: "https://example.org/5", n: 3 }]]);
assert.deepEqual(M.prFor(tpl, "acme/widgets", "b").run, [["x", {}]]);
assert.equal(M.prFor(prs, "acme/widgets", "feat/x").run, null);

// ---- branch card
assert.deepEqual(M.baseCandidates("ref: refs/remotes/origin/trunk\n"), ["trunk", "origin/trunk", "main", "origin/main", "master", "origin/master"]);
assert.deepEqual(M.baseCandidates(null), ["main", "origin/main", "master", "origin/master"]);
assert.ok(M.refFormat("main").endsWith("%1f%(ahead-behind:main)"));
const ref = (...f) => f.join("\x1f");
const out = [
  ref("feat/y", "y1", "", "", "/r/a", "1794700000", "*", "3 0"),
  ref("feat/x", "x2", "origin/feat/x", "[ahead 1, behind 2]", "", "1794600000", " ", "2 5"),
  ref("fix/old", "o1", "origin/fix/old", "", "/w/other", "1794000000", " ", "1 40"),
  ref("fix/moved", "m9", "origin/fix/moved", "[gone]", "", "1793000000", " ", "0 60"),
  ref("main", "m1", "origin/main", "[behind 4]", "", "1794650000", " ", "0 0"), ""].join("\n");
const card = M.branchCard(out, { base: "main", prs: prs.by.get("acme/widgets"), here: "/r/a" });
assert.deepEqual(card.map((r) => `${" ".repeat(r.depth)}${r.name}`), ["main", "feat/x", " feat/y", "fix/old", "fix/moved"]); // base first, the stack indented, then by date
const row = (n) => card.find((r) => r.name === n);
assert.deepEqual([row("feat/x").ahead, row("feat/x").behind, row("feat/x").mainAhead, row("feat/x").mainBehind, row("feat/x").pr.number], [1, 2, 2, 5, 9]);
assert.deepEqual([row("feat/y").current, row("feat/y").worktree, row("feat/y").upstream, row("feat/y").canGo], [true, null, null, false]);
assert.deepEqual([row("fix/old").canGo, row("fix/old").worktree], [true, "/w/other"]);          // PR merged, branch is still the PR's head
assert.deepEqual([row("fix/moved").canGo, row("fix/moved").gone, row("fix/moved").pr], [true, true, null]); // upstream gone
assert.deepEqual([row("main").isBase, row("main").canGo, row("main").pr, row("main").behind], [true, false, null, 4]);
// merged PR, but the branch moved on since: no "can go"
assert.equal(M.branchCard(ref("fix/old", "newer", "", "", "", "1", " ", "2 0"), { base: "main", prs: prs.by.get("acme/widgets") })[0].canGo, false);
// merged by ancestry alone (0 ahead of main) is no proof either
assert.equal(M.branchCard(ref("done", "d1", "origin/done", "", "", "1", " ", "0 3"), { base: "main" })[0].canGo, false);
// no base found (or a git without ahead-behind): rows without distances
assert.deepEqual((({ mainAhead, mainBehind }) => [mainAhead, mainBehind])(M.branchCard(ref("a", "1", "", "", "", "1", "*"), {})[0]), [null, null]);
// a loop of bases still lists every branch once
const loop = new Map([["a", { number: 1, state: "open", base: "b" }], ["b", { number: 2, state: "open", base: "a" }]]);
assert.equal(M.branchCard([ref("a", "1", "", "", "", "2", " ", "1 0"), ref("b", "2", "", "", "", "1", " ", "1 0")].join("\n"), { base: "main", prs: loop }).length, 2);
assert.deepEqual([0, 1, 3, 63, 5000].map((n) => M.barPx(n)), [0, 6, 12, 36, 36]);

// ---- which repos are watched: few, the ones in use, a repo once for its worktrees
const wr = [{ path: "/r/a" }, { path: "/w/a/x", main: "/r/a" }, { path: "/r/b" }, { path: "/w/z/y", main: "/elsewhere/z" }, { path: "/r/c" }];
assert.deepEqual(M.watchPlan(wr, ["/w/a/x", "/r/a", "/w/z/y", "/r/b", "/r/c"], [], 3), ["/r/a", "/w/z/y", "/r/b"]);
assert.deepEqual(M.watchPlan(wr, ["/r/c", "/r/b"], ["/r/a", "/r/b"], 3), ["/r/c"]);   // what is watched stays, the budget counts it
assert.deepEqual(M.watchPlan(wr, ["/r/c"], ["/r/a", "/r/b", "/w/z/y"], 3), []);
assert.deepEqual(M.watchPlan(wr, ["/gone", "/r/c"], [], 3), ["/r/c"]);

// ---- is the block on screen
const L = (hidden, active) => ({ id: "root", type: "row", children: [{ id: "main", type: "block", content: { tab: "active" } },
  { id: "panel", type: "column", hidden, children: [{ id: "body", type: "stack", active, children: [{ id: "files", type: "block", content: { mod: "files" } }, { id: "wt", type: "block", content: { mod: "worktrees" } }] }] }] });
assert.equal(M.blockShown(L(false, "wt"), "worktrees"), true);
assert.equal(M.blockShown(L(true, "wt"), "worktrees"), false);   // its column is hidden
assert.equal(M.blockShown(L(false, "files"), "worktrees"), false); // another child of the stack is up
assert.equal(M.blockShown(L(false, "wt"), "other"), false);
assert.equal(M.blockShown({ id: "root", type: "row", floating: [{ id: "f", content: { mod: "worktrees" } }] }, "worktrees"), true);
assert.equal(M.blockShown(null, "worktrees"), false);

// ---- rows for Go to
const items = M.gotoItems({ unpushed: [{ repo: { path: "/r/a", name: "a", slug: "acme/a", context: "blue" }, s: S({ ahead: 3, tracked: 2, branch: "feat/x" }) }],
  week: [{ repo: { path: "/r/c", name: "c", slug: null, context: null }, s: S({ tracked: 1 }) }] }, new Map([["/r/a", "s1"]]));
assert.deepEqual(items, [
  { id: "/r/a", title: "a · feat/x", subtitle: "3 not pushed · 2 changed", keywords: ["acme/a", "feat/x"], tag: "Not pushed", context: "blue", focus: { space: "s1" } },
  { id: "/r/c", title: "c · main", subtitle: "1 changed", keywords: ["main"], tag: "Changed", run: [["space.new", { folder: "/r/c", machine: "" }]] }]);
assert.equal(M.gotoItems({ unpushed: Array.from({ length: 60 }, (_, i) => ({ repo: { path: `/r/${i}`, name: `r${i}` }, s: S({ ahead: 1 }) })), week: [] }, new Map()).length, 40);

console.log("ok");
