// Run: node --test test_main.mjs   (invented data only)
// main.js itself, with stand-ins for Herdr: "herdr" answers from the object `H` below and notes what was asked,
// and every element is one object that takes any call (it notes what was made draggable). Nothing here starts a
// process or reads a file, but for one test that runs the real `find` over a throwaway folder.
import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";

const HERDR = ["theme", "shared", "setShared", "exec", "home", "appHome", "run", "focused", "layout", "props", "settings", "spaces", "panes",
  "openOverlay", "closeOverlay", "watchFolder", "readTextFile", "nextCommand", "notify", "window", "checking"];
const BASE = ["h_flex", "v_flex", "v_virtual_list", "VirtualListScrollHandle", "Scrollbar", "InputState", "Input"];
const scrolls = globalThis.SCROLLS = []; // every scroll_to_item of a ScrollHandle
const stubs = {
  herdr: HERDR.map((n) => `export const ${n} = (...a) => globalThis.H.${n}(...a);`).join("\n"),
  "gpui-kit": "export class View {}\nexport const div = globalThis.EL;",
  "gpui-base": `${BASE.map((n) => `export const ${n} = globalThis.EL;`).join("\n")}\nexport const ScrollHandle = { new: () => ({ scroll_to_item: (i) => globalThis.SCROLLS.push(i) }) };`,
  "fs/promises": "export const exists = async (p) => globalThis.H.files.includes(p);",
};
registerHooks({
  resolve: (spec, context, next) => (spec in stubs ? { url: `stub:${spec}`, shortCircuit: true } : next(spec, context)),
  load: (url, context, next) => (url.startsWith("stub:") ? { format: "module", source: stubs[url.slice(5)], shortCircuit: true } : next(url, context)),
});
let lastId = null;
const drags = [], texts = [], lists = []; // lists: [id, handle] of every element that tracks a scroll handle
const EL = globalThis.EL = new Proxy(function () {}, { apply: () => EL, get: (_t, k) => (k === "then" ? undefined
  : k === "when" ? (on, fn) => { if (on) fn(EL); return EL; }
  : k === "child" ? (c) => { if (typeof c === "string") texts.push(c); return EL; }
  : k === "id" ? (name) => { lastId = name; return EL; }
  : k === "track_scroll" ? (handle) => { lists.push([lastId, handle]); return EL; }
  : k === "drag_paths" ? (paths, ...more) => { drags.push([paths, ...more]); return EL; } : EL) });

const HOME = "/h", repo = (n) => `${HOME}/code/r${n}`;
let log, store, timers, world, live, peak, sharedNow;
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
  sharedNow = new Map(Object.entries(w.shared ?? {}));
  globalThis.H = {
    files: w.files ?? [],
    checking: () => world.checking, home: () => HOME, appHome: () => `${HOME}/app`, theme: () => ({}), settings: () => ({}), window: () => ({}),
    props: () => world.props ?? (world.shown ? { overlay: true } : {}), layout: () => null, focused: () => null, panes: () => [],
    spaces: () => world.spaces.map((folder, i) => ({ id: `s${i}`, folder, tabs: [] })),
    shared: (k) => sharedNow.get(k) ?? null, setShared: (k, v) => { log.push(["shared", k]); sharedNow.set(k, v); },
    run: (...a) => log.push(["run", ...a]), notify: (n) => log.push(["notify", n]), openOverlay: (o) => { log.push(["overlay", o]); }, closeOverlay: () => {},
    readTextFile: async (path) => world.read?.(path) ?? world.text?.[path] ?? null, nextCommand: () => never,
    exec: async (cmd, args, opts) => {
      log.push(["exec", cmd, opts?.cwd ?? args.find((a) => a.endsWith(".py")) ?? "", args]);
      if (cmd === "find" && world.find) return { code: 0, stderr: "", stdout: world.find(args) };
      if (cmd === "find" && args[1] === `${HOME}/code`) return { code: 0, stderr: "", stdout: world.repos.map((p) => `${p}/.git\n`).join("") };
      if (world.fail?.includes(cmd)) return { code: 1, stderr: "no", stdout: "" };
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
  notify() {}, stop_propagation() {}, write_to_clipboard: (text) => log.push(["clipboard", text]), focus_handle: () => ({ focus() {} }),
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
const Hub = await import("./hub.js"), EV = await import("./editor-view.js");
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

test("a commit in a worktree whose repo is not under the roots is checked", async () => {
  const wt = `${HOME}/code/feat-x`, gitdir = `${HOME}/Work/shop/.git/worktrees/feat-x`; // the repo itself is elsewhere
  reset({ repos: [wt], spaces: [wt], text: { [`${wt}/.git`]: `gitdir: ${gitdir}\n` } });
  await start();
  assert.deepEqual([...live].map((h) => h.dir), [gitdir]); // watched by its own git folder
  log.length = 0;
  [...live][0].fire(["HEAD", "logs/HEAD", "COMMIT_EDITMSG"].map((f) => `${gitdir}/${f}`)); await settle();
  assert.deepEqual(asked("exec").filter((l) => l[1] === "git").map((l) => l[2]), [wt]);
});

test("a root whose own name starts with a dot is searched (the real find)", async () => {
  const tmp = realpathSync(mkdtempSync(`${tmpdir()}/wt-find-`));
  try {
    for (const d of [".dotfiles/.git", ".dotfiles/nvim/.git", ".dotfiles/.cache/hidden/.git", ".dotfiles/node_modules/dep/.git", "code/app/.git", "code/app/sub/.git"]) mkdirSync(`${tmp}/${d}`, { recursive: true });
    const find = (args) => { try { return execFileSync("find", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); } catch (e) { return e.stdout ?? ""; } };
    reset({ find, text: { [`${HOME}/app/worktrees.config.json`]: JSON.stringify({ roots: [`${tmp}/.dotfiles`, `${tmp}/code`, `${tmp}/missing`], worktreeRoots: [] }) } });
    const panel = await start();
    // the hidden root itself and what is in it; still nothing hidden or pruned below a root
    assert.deepEqual(panel.repos.map((r) => r.path.slice(tmp.length)), ["/.dotfiles", "/.dotfiles/nvim", "/code/app", "/code/app/sub"]);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test("Go to keeps its rows when one of two copies of the panel closes", async () => {
  reset({ repos: [repo(1)], spaces: [repo(1)], shared: { "goto.api": { version: 1 } } });
  const docked = await start(), tick = timers.find(([ms]) => ms === 10000)[1], windowed = await start();
  assert.deepEqual(sharedNow.get("goto.items.worktrees"), []); // nothing needs a look in this world: an empty list, but a list
  await windowed.close();
  assert.equal(sharedNow.get("goto.items.worktrees"), null);
  tick(cx);
  assert.deepEqual(sharedNow.get("goto.items.worktrees"), []);
  await docked.close(); log.length = 0; tick(cx); // the last one went: nothing lists them again by itself
  assert.equal(sharedNow.get("goto.items.worktrees"), null);
});

test("a menu entry acts in the copy that opened this menu, not in one whose menu was closed with Esc", async () => {
  reset({ repos: [repo(1), repo(2)], spaces: [] });
  const a = await start(), b = await start();
  log.length = 0;
  EV.openEditorMenu(a, { root: repo(1) });   // … and Esc: nothing tells the copy
  EV.openEditorMenu(b, { root: repo(2) });
  const [first, second] = asked("overlay").map((l) => l[1].props.token);
  assert.ok(first && second && first !== second);
  const click = EV.menuRun("editor-copy", second); // what the entry of b's menu runs; a mod's command reaches every shown copy
  assert.equal(click, `editor-copy:${second}`);
  assert.equal(EV.menuRun("editor-use:code", second), `editor-use:${second}:code`);
  a.command(click, cx); b.command(click, cx);
  assert.deepEqual(asked("clipboard"), [["clipboard", repo(2)]]);
  a.command(click, cx); b.command(click, cx);  // a menu's entry counts once
  a.command("editor-copy", cx); b.command(`editor-copy:${first}x`, cx); // no token, or one nobody gave out
  assert.equal(asked("clipboard").length, 1);
  a.command(EV.menuRun("editor-copy", first), cx); // a's own menu is still its own
  assert.deepEqual(asked("clipboard").map((l) => l[1]), [repo(2), repo(1)]);
});

test("All: 60 rows at a time, however many checkouts there are", async () => {
  reset({ repos: Array.from({ length: 150 }, (_x, i) => repo(i + 1)), spaces: [] });
  const panel = await start(), rows = () => { drags.length = 0; panel.render(cx); return drags.length; }; // every row is made draggable once
  panel.command("show:all", cx);
  assert.equal(rows(), 60);
  panel.command("more:all", cx);
  assert.equal(rows(), 120);
  panel.command("more:all", cx);
  assert.equal(rows(), 150);
  panel.allMore = 0;
  panel.command(`expand:${repo(99)}`, cx); // a row further down whose card is open is drawn, with the ones before it
  assert.ok(rows() > 60 && drags.some(([paths]) => paths[0] === repo(99)));
});

// VS Code is installed (its app folder is there), and the Herdr home has the file that makes every editor start a dry run.
const withEditor = (path) => (path.includes("Visual Studio Code.app") ? "<plist/>" : path === `${HOME}/app/editor.dry-run` ? "" : null);

test("a dry run starts nothing and says so, with what it would have started", async () => {
  reset({ repos: [repo(1)], spaces: [], read: withEditor });
  const panel = await start();
  await EV.lookForEditors(true); // the tests before this one found no editor, and that answer is kept for ten minutes
  log.length = 0;
  panel.openEditor({ root: repo(1) }, cx); await settle();
  assert.deepEqual(asked("exec"), []);
  const [note] = asked("notify").map((l) => l[1]);
  assert.deepEqual([note.title, note.level, note.body.slice(0, 5)], ["Dry run: no editor started", "info", "open "], note.body);
  assert.ok(note.body.startsWith("open ") && note.body.includes(repo(1)), note.body);
  assert.deepEqual(JSON.parse(store.get("opened")).length, 1); // and it is still noted in the mod's storage
});

test("after a click a link says Opening <Editor> …: the short form too, and the project of a removed worktree", async () => {
  reset({ repos: [repo(7)], spaces: [], read: (p) => withEditor(p) ?? (p === `${repo(7)}/.git/HEAD` ? "ref: refs/heads/main\n" : null) });
  const panel = await start();
  await EV.lookForEditors(true);
  const target = { root: repo(7) }, drawn = (draw) => { texts.length = 0; draw(); return [...texts]; };
  const short = () => drawn(() => EV.editorLink(panel, {}, "k", target, cx, true));
  panel.open = repo(7); // its branch card: one branch is checked out in a folder that is gone
  panel.card = { path: repo(7), base: null, rows: [{ name: "feat/x", depth: 0, worktree: "/gone/wt", mainAhead: null, at: 0 }] };
  const card = () => drawn(() => panel.cardView(panel.byPath.get(repo(7)), {}, cx));
  short(); card(); await settle(); // the first draw reads the folders
  assert.deepEqual(short(), ["VS ↗"]);
  assert.ok(card().includes("Worktree removed · open r7 in") && !card().includes("Opening VS Code …"));
  panel.openEditor(target, cx);
  assert.deepEqual(short(), ["Opening VS Code …"]);
  assert.equal(card().filter((x) => x === "Opening VS Code …").length, 2); // the card's own link and the removed worktree's
  await settle();
});

test("an editor that could not be started: the toast has editor.js' words", async () => {
  const E = await import("./editor.js");
  reset({ repos: [repo(8)], spaces: [], fail: ["open"], read: (p) => (p.includes("Visual Studio Code.app") ? "<plist/>" : null) });
  const panel = await start();
  await EV.lookForEditors(true);
  log.length = 0;
  panel.openEditor({ root: repo(8) }, cx); await settle();
  assert.deepEqual(asked("exec").map((l) => l[1]), ["open"]); // one process per click
  assert.deepEqual(asked("notify").map((l) => [l[1].level, l[1].body]), [["error", E.failedText("vscode", [])]]);
});

test("the list stays scrolled: it has a name and a handle of its own, in both views", async () => {
  reset({ repos: Array.from({ length: 150 }, (_x, i) => repo(i + 1)), spaces: [] });
  const panel = await start();
  for (const show of ["needs", "all"]) {
    panel.command(`show:${show}`, cx);
    lists.length = 0; panel.render(cx);
    assert.deepEqual(lists, [["wt-list", panel.scroll]]);
  }
  scrolls.length = 0; // "All" is drawn: 60 rows and "Show 60 more of 90"
  panel.command("scroll:end", cx); panel.command("scroll:7", cx); panel.command("scroll:999", cx); panel.command("scroll:top", cx);
  assert.deepEqual(scrolls, [60, 7, 60, 0]);
  panel.command("scroll:end", cx); panel.command("show:needs", cx); panel.command("show:needs", cx); // the other list starts at its top
  assert.deepEqual(scrolls.slice(4), [60, 0]);
});
