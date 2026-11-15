// Run: node --test test_main.mjs   (invented data only)
// main.js itself, with stand-ins for Herdr: "herdr" answers from the object `H` below and notes what was asked,
// and every element is one object that takes any call. Nothing here starts a process or reads a file.
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
};
registerHooks({
  resolve: (spec, context, next) => (spec in stubs ? { url: `stub:${spec}`, shortCircuit: true } : next(spec, context)),
  load: (url, context, next) => (url.startsWith("stub:") ? { format: "module", source: stubs[url.slice(5)], shortCircuit: true } : next(url, context)),
});
globalThis.EL = new Proxy(function () {}, { get: (_t, k) => (k === "then" ? undefined : globalThis.EL), apply: () => globalThis.EL });

const HOME = "/h", repo = (n) => `${HOME}/code/r${n}`;
let log, store, timers, world;
const never = new Promise(() => {});
// world: {checking, shown, repos: [paths find lists], spaces: [paths with a space]}
function reset(w) {
  world = { checking: false, shown: true, repos: [], spaces: [], ...w };
  log = []; timers = []; store = new Map(Object.entries(w.store ?? {}));
  Object.defineProperty(globalThis, "localStorage", { configurable: true, writable: true, value: {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => { log.push(["store", k]); store.set(k, v); },
  } });
  const sharedNow = new Map();
  globalThis.H = {
    checking: () => world.checking, home: () => HOME, appHome: () => `${HOME}/app`, theme: () => ({}), settings: () => ({}), window: () => ({}),
    props: () => world.props ?? (world.shown ? { overlay: true } : {}), layout: () => null, focused: () => null, panes: () => [],
    spaces: () => world.spaces.map((folder, i) => ({ id: `s${i}`, folder, tabs: [] })),
    shared: (k) => sharedNow.get(k) ?? null, setShared: (k, v) => { log.push(["shared", k]); sharedNow.set(k, v); },
    run: (...a) => log.push(["run", ...a]), notify: () => {}, openOverlay: () => {}, closeOverlay: () => {},
    readTextFile: async () => null, nextCommand: () => never,
    exec: async (cmd, args, opts) => {
      log.push(["exec", cmd, opts?.cwd ?? args.find((a) => a.endsWith(".py")) ?? ""]);
      return { code: 0, stderr: "", stdout: cmd === "find" && args[1] === `${HOME}/code` ? world.repos.map((p) => `${p}/.git\n`).join("") : "" };
    },
    watchFolder: () => { log.push(["watch"]); return never; },
  };
}
const cx = {
  notify() {}, stop_propagation() {}, focus_handle: () => ({ focus() {} }),
  spawn: (fn) => Promise.resolve().then(() => fn(cx)),
  timer: { every: (ms, fn) => timers.push([ms, fn]), after: (_ms, fn) => setTimeout(() => fn(cx), 0) },
};
const settle = () => new Promise((done) => setTimeout(done, 30));
const asked = (kind) => log.filter((l) => l[0] === kind);

reset({});
const { default: Worktrees } = await import("./main.js");
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
