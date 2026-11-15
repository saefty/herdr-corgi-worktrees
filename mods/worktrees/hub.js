// What the panel and the history view share: this mod's shared keys, the PR providers, running a click's commands
// (through the context hook when one listens), and which folders have a space.
import { shared, setShared, run, exec, spaces, panes, window } from "herdr";
import { NAME } from "./name.js";
import * as M from "./model.js";

export const key = (k) => `${NAME}.${k}`; // this mod's shared keys
const STEP_MS = 150; // between the commands of one click, so "show a panel" lands before "tell it something"

// What the providers published (shared "<mod>.providers", "<mod>.prs.<provider>"), indexed again only when it
// changed. memo: any object that lives as long as the view.
export function prsNow(memo) {
  const docs = (shared(key("providers")) ?? []).map((p) => shared(key(`prs.${p}`))).filter(Boolean);
  const sig = docs.map((d) => `${d.at}:${d.prs?.length}`).join("|");
  if (sig !== memo.prsSig || !memo.prs) { memo.prsSig = sig; memo.prs = M.prIndex(docs); }
  return memo.prs;
}

// The commands of one click, in order.
export function runAll(list, cx) {
  list.forEach(([name, args], i) => cx.timer.after(i * STEP_MS, () => run(name, args ?? {})));
}

// The same, through the context hook when one listens in this layout: its mod switches to the context first.
export function act(context, list, cx) {
  const hook = shared("goto.context");
  if (context && hook?.request && (!hook.layouts || hook.layouts.includes(shared("layout")))) setShared(hook.request, { context, run: list, at: Date.now() });
  else runAll(list, cx);
}

// A PR mark's click: what its provider says (`run`), else the PR review mod when it is there (its hand-over
// "pr.goto"), else the browser.
export function openPr(pr, cx) {
  if (pr.run) runAll(pr.run, cx);
  else if (pr.url && shared("review.layout")) setShared("pr.goto", { url: pr.url });
  else if (pr.url) exec(window()?.platform === "macos" ? "open" : "xdg-open", [pr.url]).catch(() => null);
}
export const prWhere = (pr) => (pr.run ? "open it" : !pr.url ? "nothing to open" : shared("review.layout") ? "open it in PR review" : "open it in the browser");

// Which of these folders have a space: its folder, or a terminal of it, is inside. Map(path -> space id).
export function spaceMap(paths) {
  const ps = panes();
  return M.spaceRepos(paths, spaces().filter((s) => !s.machine)
    .map((s) => ({ id: s.id, paths: [s.folder, ...ps.filter((p) => s.tabs.some((tab) => tab.id === p.tab)).map((p) => p.cwd)].filter(Boolean) })));
}

// A folder's space, or a new one there.
export function openFolder(path, context, cx, spaceOf = spaceMap(new Set([path]))) {
  const id = spaceOf.get(path);
  act(context, id ? [["space.select", { id }]] : [["space.new", { folder: path, machine: "" }]], cx);
}
