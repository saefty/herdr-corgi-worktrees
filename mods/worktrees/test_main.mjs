// Run: node --test test_main.mjs   (invented data only)
// main.js itself, with stand-ins for Herdr: "herdr" answers from the object `H` below and notes what was asked,
// and every element is one object that takes any call (it notes what was made draggable). Nothing here starts a
// process or reads a file.
import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";

const HERDR = ["theme", "shared", "setShared", "exec", "home", "appHome", "run", "focused", "layout", "props", "settings", "spaces", "panes",
  "openOverlay", "closeOverlay", "watchFolder", "readTextFile", "nextCommand", "notify", "window", "checking"];
const BASE = ["h_flex", "v_flex", "v_virtual_list", "VirtualListScrollHandle", "Scrollbar", "InputState", "Input"];
const stubs = {
  herdr: HERDR.map((n) => `export const ${n} = (...a) => globalThis.H.${n}(...a);`).join("\n"),
  "gpui-kit": "export class View {}\nexport const div = globalThis.EL;",
  "gpui-base": BASE.map((n) => `export const ${n} = globalThis.EL;`).join("\n"),
  "fs/promises": "export const exists = async (p) => globalThis.H.files.includes(p);",
};
registerHooks({
  resolve: (spec, context, next) => (spec in stubs ? { url: `stub:${spec}`, shortCircuit: true } : next(spec, context)),
  load: (url, context, next) => (url.startsWith("stub:") ? { format: "module", source: stubs[url.slice(5)], shortCircuit: true } : next(url, context)),
});
const drags = [];
const EL = globalThis.EL = new Proxy(function () {}, { apply: () => EL, get: (_t, k) => (k === "then" ? undefined
  : k === "when" ? (on, fn) => { if (on) fn(EL); return EL; }
  : k === "drag_paths" ? (paths, ...more) => { drags.push([paths, ...more]); return EL; } : EL) });

const HOME = "/h", repo = (n) => `${HOME}/code/r${n}`;
let log, store, timers, world, live, peak;
const never = new Promise(() => {});
// world: {checking, shown, repos: [paths find lists], spaces: [paths with a space], touched: [paths with a commit
// from just now], refuse: [folders Herdr will not watch]}
function reset(w) {
  world = { checking: false, shown: true, repos: [], spaces: [], touched: [], refuse: [], ...w };
  log = []; timers = []; store = new Map(Object.entries(w.store ?? {}));
  live = new Set(); peak = 0; // the pending watchFolder calls, and the most there were at once
  Object.defineProperty(globalThis, "localStorage", { configurable: true, writable: true, value: {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => { log.push(["store", k]); store.set(k, v); },
  } });
  const sharedNow = new Map();
  globalThis.H = {
    files: w.files ?? [],
    checking: () => world.checking, home: () => HOME, appHome: () => `${HOME}/app`, theme: () => ({}), settings: () => ({}), window: () => ({}),
    props: () => world.props ?? (world.shown ? { overlay: true } : {}), layout: () => null, focused: () => null, panes: () => [],
    spaces: () => world.spaces.map((folder, i) => ({ id: `s${i}`, folder, tabs: [] })),
    shared: (k) => sharedNow.get(k) ?? null, setShared: (k, v) => { log.push(["shared", k]); sharedNow.set(k, v); },
    run: (...a) => log.push(["run", ...a]), notify: () => {}, openOverlay: () => {}, closeOverlay: () => {},
    readTextFile: async () => null, nextCommand: () => never,
    exec: async (cmd, args, opts) => {
      log.push(["exec", cmd, opts?.cwd ?? args.find((a) => a.endsWith(".py")) ?? "", args]);
      if (cmd === "find" && args[1] === `${HOME}/code`) return { code: 0, stderr: "", stdout: world.repos.map((p) => `${p}/.git\n`).join("") };
      if (cmd === "git" && args[0] === "show") return { code: 0, stderr: "", stdout: world.show ?? "" };
      if (cmd === "stat") return { code: 0, stderr: "", stdout: world.touched.map((p) => `${Math.floor(Date.now() / 1000)} ${p}/.git/logs/HEAD\n`).join("") };
      return { code: 0, stderr: "", stdout: "" };
    },
    // As Herdr's: a promise of the changed paths with cancel(), which resolves it with [].
    watchFolder: (dir) => {
      log.push(["watch", dir]);
      let done;
      const h = world.refuse.includes(dir) ? Promise.reject(new Error("already watching 64 folders")) : new Promise((r) => { done = r; });
      h.dir = dir;
      h.cancel = () => { if (live.delete(h)) { log.push(["cancel", dir]); done([]); } };
      h.fire = (paths) => { live.delete(h); done(paths); };
      if (done) { live.add(h); peak = Math.max(peak, live.size); }
      return h;
    },
  };
}
const cx = {
  notify() {}, stop_propagation() {}, focus_handle: () => ({ focus() {} }),
  spawn: (fn) => Promise.resolve().then(() => fn(cx)),
  timer: { every: (ms, fn) => timers.push([ms, fn]), after: (_ms, fn) => setTimeout(() => fn(cx), 0) },
};
const settle = () => new Promise((done) => setTimeout(done, 30));
const asked = (kind) => log.filter((l) => l[0] === kind);
const watching = () => [...live].map((h) => +h.dir.slice(`${HOME}/code/r`.length, -"/.git".length)).sort((a, b) => a - b);
// git was asked about checkout n after the watch on it was started
const readAfterWatch = (n) => { const on = log.findIndex((l) => l[0] === "watch" && l[1] === `${repo(n)}/.git`); return on >= 0 && log.slice(on).some((l) => l[1] === "git" && l[2] === repo(n)); };

reset({});
const { default: Worktrees } = await import("./main.js");
const Hub = await import("./hub.js");
const start = async () => { const v = new Worktrees(); v.init({}, cx); await settle(); return v; };
const remembered = () => ({ repos: JSON.stringify({ v: 1, at: 1, where: "", repos: [{ path: repo(1), name: "r1", rel: "r1", gitdir: `${repo(1)}/.git`, common: `${repo(1)}/.git`, main: null, kind: "repo" }] }) });

test("herdr-app check: init starts no process and no watch, and writes nothing", async () => {
  reset({ checking: true, repos: [repo(1)], spaces: [repo(1)], store: remembered() });
  const panel = await start();
  assert.deepEqual([log, timers], [[], []]);
  assert.equal(panel.repos.length, 1); // the remembered list is there to draw
  panel.render(cx);
  world.props = { history: repo(1) }; // the history view of a checkout
  (await start()).render(cx);
  assert.deepEqual([log, timers], [[], []]);
});

test("a live window: the same init looks for checkouts and asks about them", async () => {
  reset({ repos: [repo(1)], spaces: [repo(1)], store: remembered() });
  await start();
  assert.ok(asked("exec").some((l) => l[1] === "find"));
  assert.ok(asked("exec").some((l) => l[1] === "python3" && l[2].endsWith("/mods/worktrees/probe.py")));
  assert.ok(asked("exec").some((l) => l[1] === "git" && l[2] === repo(1)));
  assert.ok(asked("store").length > 0 && asked("shared").length > 0 && asked("watch").length > 0 && timers.length > 0);
  world.props = { history: repo(1) };
  log.length = 0;
  await start();
  assert.ok(asked("exec").some((l) => l[1] === "git" && l[2] === repo(1)));
});

test("watches: the checkouts in use only, cancelled when one leaves, read when one starts", async () => {
  reset({ repos: [1, 2, 3, 4, 5, 6].map(repo), spaces: [1, 2, 3].map(repo), touched: [repo(5)] });
  const panel = await start();
  assert.deepEqual(watching(), [1, 2, 3, 5]); // nobody is in 4 and 6
  assert.ok([1, 2, 3, 5].every(readAfterWatch));
  // r1 to r3 were watched before the first check, which read them: asked once. r5 came into use with that check.
  assert.deepEqual([1, 2, 3, 4, 5, 6].map((n) => asked("exec").filter((l) => l[1] === "git" && l[2] === repo(n)).length), [1, 1, 1, 1, 2, 1]);

  // A space opens on r4 and the one on r1 closes: seen at the next check of the checkouts in use.
  world.spaces = [2, 3, 4].map(repo); log.length = 0;
  panel.command("tick", cx); await settle();
  assert.deepEqual(watching(), [2, 3, 4, 5]);
  assert.deepEqual(asked("cancel"), [["cancel", `${repo(1)}/.git`]]);
  assert.deepEqual(asked("watch"), [["watch", `${repo(4)}/.git`]]); // the others keep the call they have
  assert.ok(readAfterWatch(4));

  // A commit in r2: checked, and watched again with one call.
  log.length = 0;
  [...live].find((h) => h.dir === `${repo(2)}/.git`).fire([`${repo(2)}/.git/HEAD`]); await settle();
  assert.deepEqual(asked("exec").filter((l) => l[1] === "git").map((l) => l[2]), [repo(2)]);
  assert.deepEqual(asked("watch"), [["watch", `${repo(2)}/.git`]]);
  assert.deepEqual(watching(), [2, 3, 4, 5]);

  // Hidden: r5 has no space, so its watch is given back. On screen again: watched again, and read.
  world.shown = false; log.length = 0;
  timers.find(([ms]) => ms === 10000)[1](cx); await settle();
  assert.deepEqual(watching(), [2, 3, 4]);
  assert.deepEqual(asked("cancel"), [["cancel", `${repo(5)}/.git`]]);
  world.shown = true; log.length = 0;
  panel.render(cx); await settle();
  assert.deepEqual(watching(), [2, 3, 4, 5]);
  assert.ok(readAfterWatch(5));

  // A checkout that is gone at the next look: cancelled too.
  world.repos = [3, 4, 5, 6].map(repo); log.length = 0;
  panel.refresh(cx); await settle();
  assert.deepEqual(watching(), [3, 4, 5]);
  assert.deepEqual(asked("cancel"), [["cancel", `${repo(2)}/.git`]]);
  assert.equal(peak, 4);
});

test("watches: never more than 32 at once, and a refused one is asked once per plan", async () => {
  const all = Array.from({ length: 40 }, (_x, i) => repo(i + 1));
  reset({ repos: all, spaces: all, refuse: [`${repo(2)}/.git`] });
  const panel = await start();
  assert.equal(live.size, 31); // 32 planned, one refused
  assert.equal(peak, 31);
  assert.equal(asked("watch").filter((l) => l[1] === `${repo(2)}/.git`).length, 2); // after the scan and after the first check
  world.spaces = all.slice(20); // other checkouts come into use: the old watches go first
  panel.command("tick", cx); await settle();
  assert.equal(live.size, 20);
  assert.ok(peak <= 32);
});

test("drag onto a terminal: a checkout's row is its folder, a commit's file the file in the checkout if it is there", async () => {
  reset({ repos: [repo(1)], spaces: [], files: [`${repo(1)}/src/a.txt`, `${repo(1)}/b\tc.txt`],
    show: "Ann\x1f2026-11-15T10:00:00+00:00\x1ffix: a\x1e\n1\t0\tsrc/a.txt\n0\t3\tgone.txt\n2\t2\t../../etc/passwd\n1\t1\tb\tc.txt\n" });
  const panel = await start();
  panel.command("show:all", cx);
  drags.length = 0; panel.render(cx);
  assert.deepEqual(drags, [[[repo(1)]]]); // local: no machine named

  world.props = { history: repo(1) };
  const view = (await start()).hist;
  view.nodes = [{ id: "abc1234", commit: { hash: "abc1234", subject: "fix: a", refs: { heads: [] } } }];
  view.pick(0, cx); await settle();
  drags.length = 0; view.details({}, cx);
  assert.deepEqual(drags, [[[`${repo(1)}/src/a.txt`]]]); // not the deleted file, not one outside the checkout, not one with a tab in its name
  assert.deepEqual(view.detail.data.files.map((f) => f.here), [false, false, false, false]); // editor links stay for commits of the checked-out branch
});

test("a PR mark's click hands an https address to the system and nothing else", async () => {
  reset({});
  for (const url of ["file:///Applications/Calculator.app", "/Applications/Calculator.app", "http://example.org/1", "https://example.org/a b"]) {
    Hub.openPr({ url, run: null }, cx);
    assert.equal(Hub.prWhere({ url, run: null }), "nothing to open");
  }
  assert.deepEqual(log, []);
  Hub.openPr({ url: "https://example.org/pull/1", run: null }, cx);
  assert.deepEqual(asked("exec").map((l) => [l[1], l[3]]), [["xdg-open", ["https://example.org/pull/1"]]]);
});
