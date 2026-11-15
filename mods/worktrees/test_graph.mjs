// Run: node --test test_graph.mjs   (invented data only)
import assert from "node:assert/strict";
import * as G from "./graph.js";

const NO = { head: null, heads: [], remotes: [], tags: [] };
// c("f2", "f1", "feat/x"): a commit, its parents (space separated), its local branches
const c = (hash, parents = "", ...heads) => ({ hash, parents: parents ? parents.split(" ") : [], refs: { ...NO, heads }, subject: `commit ${hash}`, author: "Ada Lovelace", at: 1 });
// lanes without their colors (those have a test of their own)
const bare = (r) => ({ ...r, rows: r.rows.map(({ color: _c, top, bottom, through, ...row }) => ({ ...row, top: top.map(({ color: _x, ...e }) => e), bottom: bottom.map(({ color: _x, ...e }) => e), through: through.map(({ color: _x, ...e }) => e) })) });
const draw = (commits, base) => bare(G.lanes(G.plan(commits, new Set(commits.map((x) => x.hash))), { base }));
const lanesOf = (r) => r.rows.map((x) => x.lane);

// ---- git log text
assert.deepEqual(G.logArgs("branches", { base: "main", max: 400 }).slice(-7), ["-n", "401", "--branches", "--end-of-options", "HEAD", "main", "--"]);
assert.deepEqual(G.logArgs("branch", { base: "main", branch: "feat/x" }).slice(-4), ["--end-of-options", "feat/x", "main", "--"]);
assert.deepEqual(G.logArgs("branch", { base: "main", branch: "main" }).slice(-3), ["--end-of-options", "main", "--"]);
assert.deepEqual(G.logArgs("all").slice(-5), ["--exclude=refs/stash", "--all", "--end-of-options", "HEAD", "--"]);
assert.deepEqual(G.refsOf("HEAD -> refs/heads/feat/x, refs/remotes/origin/feat/x, refs/remotes/origin/HEAD, tag: refs/tags/v1.2, refs/stash"),
  { head: "feat/x", heads: ["feat/x"], remotes: ["origin/feat/x"], tags: ["v1.2"] });
assert.deepEqual(G.refsOf("HEAD, refs/heads/main"), { head: true, heads: ["main"], remotes: [], tags: [] }); // detached
assert.deepEqual(G.refsOf(""), NO);
const rec = (...f) => f.join("\x1f");
const log = G.parseLog([rec("a".repeat(40), `${"b".repeat(40)} ${"c".repeat(40)}`, "HEAD -> refs/heads/main", "feat: merge, with a comma", "Ada Lovelace", "1794700000"),
  rec("b".repeat(40), "", "", "chore: start", "Grace", "1794600000"), ""].join("\0"));
assert.equal(log.commits.length, 2);
assert.deepEqual(log.commits[0], { hash: "a".repeat(40), parents: ["b".repeat(40), "c".repeat(40)], refs: { head: "main", heads: ["main"], remotes: [], tags: [] }, subject: "feat: merge, with a comma", author: "Ada Lovelace", at: 1794700000000 });
assert.deepEqual([log.commits[1].parents, log.more], [[], false]);
assert.deepEqual((({ commits, more }) => [commits.length, more])(G.parseLog([rec("a".repeat(40), "", "", "s", "x", "1"), rec("b".repeat(40), "", "", "s", "x", "1")].join("\0"), 1)), [1, true]);
assert.deepEqual(G.parseLog("").commits, []);

// ---- chips
assert.deepEqual(G.chips({ head: "feat/x", heads: ["feat/x", "wip"], remotes: ["origin/feat/x", "fork/feat/x", "origin/other"], tags: ["v1"] }), [
  { kind: "branch", name: "feat/x", head: true, synced: ["origin", "fork"] }, { kind: "branch", name: "wip", head: false, synced: [] },
  { kind: "remote", name: "origin/other" }, { kind: "tag", name: "v1" }]);
assert.deepEqual(G.chips({ ...NO, head: true }), [{ kind: "head", name: "HEAD" }]);

// ---- lanes: linear
const lin = draw([c("m3", "m2", "main"), c("m2", "m1"), c("m1")], "m3");
assert.deepEqual(lanesOf(lin), [0, 0, 0]);
assert.deepEqual(lin.rows[0], { lane: 0, name: "main", top: [], bottom: [{ to: 0, name: "main" }], through: [] }); // a tip: nothing above
assert.deepEqual(lin.rows[1].top, [{ from: 0, name: "main" }]);
assert.deepEqual(lin.rows[2].bottom, []);                                                                           // a root: nothing below
assert.equal(lin.width, 1);

// ---- a branch forking off: the base keeps lane 0 although the branch is listed first
const fork = draw([c("f2", "f1", "feat/x"), c("f1", "m1"), c("m2", "m1", "main"), c("m1")], "m2");
assert.deepEqual(lanesOf(fork), [1, 1, 0, 0]);
assert.deepEqual(fork.rows[0].through, []);                          // the reserved base lane draws nothing above its tip
assert.deepEqual(fork.rows[1].bottom, [{ to: 1, name: "feat/x" }]);
assert.deepEqual(fork.rows[2].through, [{ lane: 1, name: "feat/x" }]);
assert.deepEqual(fork.rows[3].top, [{ from: 0, name: "main" }, { from: 1, name: "feat/x" }]); // both arrive at the fork point
assert.equal(fork.width, 2);
// a branch sitting right on the base's tip: its lane meets lane 0 at that tip
const onTip = draw([c("f1", "m2", "feat/y"), c("m2", "m1", "main"), c("m1")], "m2");
assert.deepEqual([lanesOf(onTip), onTip.rows[0].bottom, onTip.rows[1].top], [[1, 0, 0], [{ to: 1, name: "feat/y" }], [{ from: 1, name: "feat/y" }]]);

// ---- a merge
const merge = draw([c("m3", "m2 f1", "main"), c("f1", "m1"), c("m2", "m1"), c("m1")], "m3");
assert.deepEqual(lanesOf(merge), [0, 1, 0, 0]);
assert.deepEqual(merge.rows[0].bottom, [{ to: 0, name: "main" }, { to: 1, name: "f1" }]);
assert.deepEqual(merge.rows[1].through, [{ lane: 0, name: "main" }]);
assert.deepEqual(merge.rows[3].top.map((t) => t.from), [0, 1]);

// ---- an octopus merge: one lane per parent
const octo = draw([c("m2", "m1 a1 b1", "main"), c("a1", "m1"), c("b1", "m1"), c("m1")], "m2");
assert.deepEqual(octo.rows[0].bottom.map((b) => b.to), [0, 1, 2]);
assert.deepEqual([lanesOf(octo), octo.width], [[0, 1, 2, 0], 3]);
assert.deepEqual(octo.rows[3].top.map((t) => t.from), [0, 1, 2]);

// ---- several roots, and a lane that ended is used again (the leftmost free one)
const roots = draw([c("m2", "m1", "main"), c("x2", "x1", "import"), c("x1"), c("y1", "", "notes"), c("m1")], "m2");
assert.deepEqual(lanesOf(roots), [0, 1, 1, 1, 0]);
assert.deepEqual([roots.rows[2].bottom, roots.rows[3].top, roots.width], [[], [], 2]);

// ---- two branches on one commit: one node, one lane, two chips
const twin = [c("f1", "m1", "feat/a", "feat/b"), c("m1", "", "main")];
assert.deepEqual(lanesOf(draw(twin, "m1")), [1, 0]);
assert.equal(G.chips(twin[0].refs).length, 2);

// ---- a parent git did not list (the cap): its lane stays open to the last row
const cut = draw([c("m2", "m1", "main"), c("f1", "gone", "feat/x"), c("m1", "older")], "m2");
assert.deepEqual(cut.rows[2].through, [{ lane: 1, name: "feat/x" }]);
assert.deepEqual(cut.rows[2].bottom, [{ to: 0, name: "main" }]);

// ---- stable: a new commit on top of one branch leaves every other row where it was
const before = [c("f1", "m1", "feat/x"), c("g1", "m1", "feat/y"), c("m2", "m1", "main"), c("m1")];
const after = [c("f2", "f1", "feat/x"), { ...c("f1", "m1") }, ...before.slice(1)];
assert.deepEqual(lanesOf(draw(after, "m2")).slice(1), lanesOf(draw(before, "m2")));
assert.equal(G.colorOf("feat/x"), G.colorOf("feat/x"));
assert.ok(G.colorOf("feat/x") >= 0 && G.colorOf("feat/x") < 6);
// colors: the base is -1, a branch has the color of its name, and lanes drawn at the same time never share one
const six = G.lanes(G.plan([..."abcdef"].map((n) => c(`${n}1`, "m1", `feat/${n}`)).concat([c("m1", "", "main")]), new Set(["a1", "b1", "c1", "d1", "e1", "f1", "m1"])), { base: "m1" });
assert.equal(new Set(six.rows.slice(0, 6).map((r) => r.color)).size, 6);
assert.deepEqual([six.rows[6].color, six.colors.get("main"), six.rows[0].color], [-1, -1, G.colorOf("feat/a")]);
assert.deepEqual(six.rows[6].top.map((e) => e.color).sort(), [0, 1, 2, 3, 4, 5]);
// a repo's branches get their colors once, by name: the same in every view, spread over the six
const pal = G.palette(["feat/a", "feat/b", "feat/c", "feat/d", "feat/e", "feat/f", "main"]);
assert.equal(new Set([...pal.values()]).size, 6);
assert.deepEqual([...G.palette(["feat/b", "main", "feat/a", "feat/a"])].slice(0, 2).map(([n]) => n), ["feat/a", "feat/b"]);
assert.equal(G.palette(["feat/a", "zzz"]).get("feat/a"), G.palette(["feat/a"]).get("feat/a"));          // a later name does not move an earlier one
const fixed = G.lanes(G.plan([c("f1", "m1", "feat/x"), c("m1", "", "main")], new Set(["f1", "m1"])), { base: "m1", colors: new Map([["feat/x", 4]]) });
assert.deepEqual([fixed.rows[0].color, fixed.rows[1].color], [4, -1]);

// ---- what is shown, and folds
// main m6..m1, feat/x forks at m3 (f1, f2), an old side branch s1 was merged at m2
const hist = [c("f2", "f1", "feat/x"), c("f1", "m3"), c("m6", "m5", "main"), c("m5", "m4"), c("m4", "m3"), c("m3", "m2"), c("m2", "m1 s1"), c("s1", "m1"), c("m1")];
hist[6].refs = { ...NO, tags: ["v1.0"] };
const vis = G.shown(hist, { base: "m6" });
assert.deepEqual([...vis].sort(), ["f1", "f2", "m2", "m3", "m6"]); // unmerged work, the fork point, the tag, the base's tip
assert.deepEqual([...G.reachable(hist, "m6")].sort(), ["m1", "m2", "m3", "m4", "m5", "m6", "s1"]);
const nodes = G.plan(hist, vis, new Set(), 2);
assert.deepEqual(nodes.map((n) => (n.fold ? `${n.id}(${n.fold})` : n.id)), ["f2", "f1", "m6", "fold:m5(2)", "m3", "m2", "fold:s1(2)"]);
assert.deepEqual(nodes.map((n) => n.parents), [["f1"], ["m3"], ["fold:m5"], ["m3"], ["m2"], ["fold:s1"], []]); // parents point at nodes
assert.deepEqual(lanesOf(G.lanes(nodes, { base: "m6" })), [1, 1, 0, 0, 0, 0, 0]);
assert.deepEqual(G.plan(hist, vis).map((n) => n.id), ["f2", "f1", "m6", "m5", "m4", "m3", "m2", "s1", "m1"]); // by default two commits are not worth a fold
const opened = G.plan(hist, vis, new Set(["fold:m5"]), 2);
assert.deepEqual(opened.map((n) => n.id), ["f2", "f1", "m6", "m5", "m4", "m3", "m2", "fold:s1"]);
assert.deepEqual([opened[3].unfolded, opened[3].parents, opened[4].parents], ["fold:m5", ["m4"], ["m3"]]);
assert.equal(G.shown(hist, { all: true }).size, 9);
assert.equal(G.shown(hist, {}).size, 9);                                     // no base known: everything
assert.deepEqual([...G.shown(hist, { base: "m6", filter: "feat/x" })], ["f2"]); // a filter: by ref name ...
assert.deepEqual([...G.shown(hist, { filter: "commit s1" })], ["s1"]);       // ... or by subject
// hidden commits next to each other in the list but not connected: a fold each, never one false knot
const apart = [c("a2", "a1", "feat/a"), c("b2", "b1", "feat/b"), c("a1", "m1"), c("b1", "m1"), c("m1", "", "main")];
const two = G.plan(apart, new Set(["a2", "b2", "m1"]), new Set(), 1);
assert.deepEqual(two.map((n) => [n.id, n.parents]), [["a2", ["fold:a1"]], ["b2", ["fold:b1"]], ["fold:a1", ["m1"]], ["fold:b1", ["m1"]], ["m1", []]]);
assert.deepEqual(G.plan([], new Set()), []);

// ---- 400 commits: layout stays far below one script slice (about 50 ms)
const big = [];
for (let i = 400; i >= 1; i--) {
  const branchy = i % 9 === 0, merge = i % 13 === 0 && i > 20;
  big.push(c(`m${i}`, i === 1 ? "" : merge ? `m${i - 1} s${i}` : `m${i - 1}`, ...(i === 400 ? ["main"] : [])));
  if (branchy) big.splice(big.length - 1, 0, c(`t${i}`, `u${i}`, `feat/topic-${i}`), c(`u${i}`, `m${i - 1}`)); // an unmerged branch of two commits
  if ((i + 1) % 13 === 0 && i + 1 > 20) big.push(c(`s${i + 1}`, `m${i - 2}`));                                   // the side commit a merge above brought in
}
const t0 = performance.now();
const bigVis = G.shown(big, { base: "m400" }), bigNodes = G.plan(big, bigVis), bigLanes = G.lanes(bigNodes, { base: "m400" });
const allLanes = G.lanes(G.plan(big, G.shown(big, { all: true })), { base: "m400" });
const ms = performance.now() - t0;
assert.equal(bigLanes.rows.length, bigNodes.length);
assert.ok(allLanes.rows.length >= 400 && allLanes.width < 12, `width ${allLanes.width}`);
assert.ok(ms < 40, `layout of ${big.length} commits took ${ms.toFixed(1)} ms`);
console.log(`layout: ${big.length} commits, folded view ${bigNodes.length} rows, both views in ${ms.toFixed(2)} ms`);

// ---- words
assert.equal(G.middle("feat/short", 20), "feat/short");
assert.equal(G.middle("feat/a-very-long-branch-name-that-says-everything-twice", 24), "feat/a-very-l…hing-twice");
assert.equal(G.middle("feat/a-very-long-branch-name-that-says-everything-twice", 24).length, 24);
assert.deepEqual(["Ada Lovelace", "ada", "grace.hopper", ""].map(G.initials), ["AL", "A", "GH", ""]);
assert.deepEqual(G.conventional("feat(api)!: add retries"), { type: "feat", lead: "feat(api)!:", rest: "add retries" });
assert.deepEqual(G.conventional("Merge branch 'x'"), { type: null, lead: "", rest: "Merge branch 'x'" });
assert.deepEqual(G.parseShow("Ada Lovelace\x1f2026-11-14T10:00:00+01:00\x1ffeat: add retries\n\nLonger text.\n\x1e\n3\t1\tsrc/a.js\n-\t-\tlogo.png\n10\t0\tpath with\ttab\n"),
  { author: "Ada Lovelace", date: "2026-11-14T10:00:00+01:00", message: "feat: add retries\n\nLonger text.", files: [{ path: "src/a.js", add: 3, del: 1 }, { path: "logo.png", add: null, del: null }, { path: "path with\ttab", add: 10, del: 0 }] });
assert.deepEqual(G.parseShow("").files, []);

console.log("ok");
