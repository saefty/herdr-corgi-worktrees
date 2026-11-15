// The Herdr side of "Open in <Editor>" (editor.js has the table and the rules; it is the same file in every mod of
// the set, and the choice is shared between them). One process per click, none to find the installed editors or to
// look at a folder, "Opening …" for three seconds, and a toast only when it did not open.
import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { exec, run, shared, setShared, readTextFile, openOverlay, closeOverlay, props, theme, home, notify, window } from "herdr";
import { NAME } from "./name.js";
import * as E from "./editor.js";

const KEY = "editors", DAY = 86400000, CHOICE = "editor.choice", OPENING_MS = 3000;
let known = null, looking = null, asked = false, extra = []; // {at, found}; the lookup under way; one was queued; the settings' own editors
let dry = false, settled; // "dryRun" in the settings; a click waits until the settings were read once
const settings = new Promise((done) => { settled = done; });
const roots = new Map();   // folder → {marks, common, linked, there}: read as files, once per folder
const reading = new Map(); // folder → the promise of that read
const opening = new Map(); // a target's key → until when its link says "Opening …" and takes no click
export const SHORT_W = 40; // a row's reserved width for the monogram
const tilde = (p) => (p.startsWith(`${home()}/`) ? `~${p.slice(home().length)}` : p);

// The mod's settings (model.js configOf): "editors", and "dryRun": a click starts nothing and notes the program and
// its arguments in the mod's storage (key "opened", the newest twenty). For test homes: a stand-in `open` on the PATH
// is not enough there, a window that runs with your own home folder can still reach the real one.
export const configure = (cfg) => { extra = E.extraEditors(cfg?.editors); dry = cfg?.dryRun === true; settled(); };
const stored = () => { if (!known) { try { known = JSON.parse(localStorage.getItem(KEY) ?? "null"); } catch { known = null; } } return known; };

// The installed editors, found by reading the files that say so (editor.js candidates). Within a day the remembered
// answer is taken (force: the menu's "Look again", and after an editor could not be started).
export function lookForEditors(force = false) {
  const s = stored();
  if (!force && s && Date.now() - s.at < DAY) return Promise.resolve(s.found);
  return (looking ??= (async () => {
    const cands = E.candidates(home(), window()?.platform === "macos" ? "darwin" : "linux");
    const present = await Promise.all(cands.map((c) => readTextFile(c.path).then((x) => x !== null).catch(() => false)));
    known = { at: Date.now(), found: E.foundFrom(cands, present) };
    try { localStorage.setItem(KEY, JSON.stringify(known)); } catch { /* kept in memory */ }
    return known.found;
  })().finally(() => { looking = null; })); // also after a failure: the next ask looks again
}

// Whether there is any editor to open things in (as far as the last look knows): rows keep room for a link only then.
export const haveEditors = () => E.installed(stored()?.found ?? {}, extra).length > 0;

// What a folder says about itself, read as files: whether it is still there (a checkout has `.git`, a file in a
// linked worktree and a folder with HEAD in the main one), the shared git folder, and the marks of a JVM project
// (`.idea` is a folder: a file IntelliJ keeps in it stands for it). Taken as there until the files were read.
export function rootInfo(root, cx) {
  if (!roots.has(root)) {
    roots.set(root, { marks: [], there: true, ...E.gitLink(null, root) });
    const read = (f) => readTextFile(`${root}/${f}`).catch(() => null);
    reading.set(root, Promise.all([read(".git"), read(".git/HEAD"), ...E.PROJECT_MARKS.map((m) => read(m === ".idea" ? ".idea/misc.xml" : m))]).then(([git, head, ...got]) => {
      roots.set(root, { marks: E.PROJECT_MARKS.filter((_m, k) => got[k] !== null), there: git !== null || head !== null, ...E.gitLink(git, root) });
    }));
    later(cx, () => reading.get(root));
  }
  return roots.get(root);
}
// Draws again when something asked for during a render is there. A render's cx is only good for that call: a timer
// gives a new one, and a spawn's stays good across the wait.
const later = (cx, wait) => cx?.timer?.after?.(0, (cx) => cx.spawn(async (cx) => { await wait(); cx.notify(); }));
// The same once the files were read: a command names a folder no link has shown yet.
export const rootRead = async (root) => { rootInfo(root, null); await reading.get(root); return roots.get(root); };
export const forgetRoots = () => { roots.clear(); reading.clear(); }; // ↻: folders may have gone or come back

// The checkout a path is in: the longest of the known ones, else the first folder upwards that has `.git`.
export async function checkoutOf(path, knownRoots = []) {
  const hit = knownRoots.filter((r) => path === r || path.startsWith(`${r}/`)).sort((a, b) => b.length - a.length)[0];
  if (hit) return hit;
  for (let dir = path.replace(/\/+$/, ""); dir.length > 1; dir = dir.slice(0, dir.lastIndexOf("/"))) {
    const [git, head] = await Promise.all([".git", ".git/HEAD"].map((f) => readTextFile(`${dir}/${f}`).catch(() => null)));
    if (git !== null || head !== null) return dir;
  }
  return null;
}

// The editor a link for this target names: {id, why}, or null while the editors are not known yet or none is
// installed (then there is no link). target: {root (the checkout's folder), file? (below it), line?, where? (words
// for the tooltip), main? ({path, name}: the project's main checkout, for a worktree's row)}.
export function editorFor(target, cx) {
  if (!target?.root) return null;
  const s = stored(), r = rootInfo(target.root, cx);
  if (!s) { if (!looking && !asked && cx) { asked = true; later(cx, () => lookForEditors().finally(() => { asked = false; })); } return null; }
  return E.editorOf({ file: target.file ?? null, marks: r.marks, linked: r.linked, choice: shared(CHOICE), key: r.common, found: s.found, extra });
}

// A click: ONE process. id: another editor than the target's own (the ▾ menu). A sentence when it did not open.
async function openIn(target, id = null) {
  const file = target.file ? E.safeFile(target.root, target.file) : null;
  if (target.file && !file) return "This path is not a file of the checkout.";
  await settings; // never before "dryRun" is known
  const found = await lookForEditors();
  await rootRead(target.root);
  const use = id ?? editorFor(target, null)?.id;
  const argv = use ? E.openArgv(use, found[use], file ? { file, line: target.line ?? null } : { dir: target.root }, extra) : null;
  if (!argv) return "No editor to open this in was found.";
  if (dry) { try { localStorage.setItem("opened", JSON.stringify([...JSON.parse(localStorage.getItem("opened") ?? "[]"), [argv[0], ...argv[1]]].slice(-20))); } catch { /* none */ } return null; }
  const r = await exec(argv[0], argv[1], { timeout: 20000 }).catch((e) => ({ code: 1, stderr: String(e) }));
  if (r.code === 0) return null;
  known = null; try { localStorage.removeItem(KEY); } catch { /* none */ } // it may be gone: look again the next time
  return `${E.editorName(use, extra)} could not be started. Choose another editor with ▾.`;
}

const keyOf = (target) => `${target.root}\n${target.file ?? ""}\n${target.line ?? ""}`;
const isOpening = (target) => (opening.get(keyOf(target)) ?? 0) > Date.now();
// A click on a link: it says "Opening …" at once and for three seconds and takes no second click (a lock per
// target, not for the whole mod); only a failure is said, as a toast.
export function startOpen(target, cx, id = null) {
  if (!target?.root || isOpening(target)) return;
  opening.set(keyOf(target), Date.now() + OPENING_MS); cx.notify();
  cx.timer.after(OPENING_MS, (cx) => { if (!isOpening(target)) opening.delete(keyOf(target)); cx.notify(); });
  cx.spawn(async (cx) => { const note = await openIn(target, id); if (note) { opening.delete(keyOf(target)); notify({ title: "Open in editor", body: note, level: "error" }); cx.notify(); } });
}

// The ▾ menu, at most six entries ([label, command, muted, tooltip]), from editor.js' plain data: the editor in use
// and why, the other installed ones, for a worktree's row "Open the project folder instead", "Copy path" (a folder's
// is added here), "Look again". Other editors give way when there are more than six.
export function menuOf(target) {
  const r = roots.get(target.root) ?? { linked: false }, main = target.main && target.main.path !== target.root ? target.main : null;
  const project = main ? `Open ${tilde(main.path)}${target.branch ? ` (the branch ${target.branch} is checked out in the worktree, not there)` : ""}.` : null;
  const data = E.menuItems({ now: editorFor(target, null), found: stored()?.found ?? {}, extra, linked: r.linked, file: target.file ?? null, line: target.line ?? null, project });
  if (!target.file) data.splice(data.length - 1, 0, { kind: "copy", text: "Copy path", hint: tilde(target.root) });
  for (let k = data.length - 1; k >= 0 && data.length > 6; k--) if (data[k].kind === "editor") data.splice(k, 1);
  return data.map((m) => m.kind === "now" ? [`${m.text} · ${m.hint}`, "editor-none", true, ""]
    : m.kind === "editor" ? [`${m.text}${m.hint ? ` (${m.hint})` : ""}`, `editor-use:${m.id}`, false, ""]
    : m.kind === "project" ? [m.text, "editor-main", false, m.hint]
    : m.kind === "copy" ? [target.file ? `${m.text} (${m.hint})` : m.text, "editor-copy", false, target.file ? "" : m.hint]
    : [m.text, "editor-look", false, ""]);
}
export function openEditorMenu(view, target) {
  view.editorTarget = target;
  const items = menuOf(target);
  // as wide as its longest entry needs: the note on IntelliJ in a worktree is the long one, and it must be readable
  const width = Math.min(760, Math.max(280, 36 + 7 * Math.max(...items.map((m) => m[0].length))));
  openOverlay({ mod: NAME, kind: "popup", width, height: 12 + 30 * items.length, props: { menu: items } });
}
// The menu's own copy of the mod (props {menu}): an entry runs <mod>.<command> in the copy that opened it.
export function renderMenu() {
  const t = theme(), { menu = [], overlay } = props();
  return v_flex().id("ed-menu").size_full().p(4).gap(1).bg(t.popover).text_color(t.foreground).text_size(12.5)
    .children(menu.map(([label, command, muted, tip], k) => div().id(`ed-m-${k}`).px(10).py(5).rounded(5).truncate().text_color(muted ? t.muted : t.foreground)
      .tooltip(tip || label)
      .when(command !== "editor-none", (e) => e.cursor_pointer().hover((s) => s.bg(t.hover)).on_click(() => { run(`${NAME}.${command}`); closeOverlay(overlay); })).child(label)));
}

// What a place shows for a target: null when there is no link (no editor, or none known yet).
function mark(target, cx, short) {
  const ed = editorFor(target, cx);
  if (!ed) return null;
  const busy = isOpening(target), where = target.where ? ` ${target.where}` : "";
  const tip = target.file ? E.linkTip(ed.id, { file: target.file, line: target.line ?? null, where: target.where ?? "" }, extra) : `Open ${tilde(target.root)} in ${E.editorName(ed.id, extra)}${where}.`;
  return { id: ed.id, busy, text: busy ? (short ? "…" : E.openingLabel(ed.id, extra)) : short ? E.shortLabel(ed.id, extra) : E.linkLabel(ed.id, extra), tip };
}

// The link for a place: [] when there is nothing to open in. Link form: the editor's name and a ▾ with the menu.
// Short form (a row): the monogram in a reserved width; a right click opens the menu. view.openEditor(target, cx)
// is the click.
export function editorLink(view, t, key, target, cx, short = false) {
  const m = mark(target, cx, short);
  if (!m) return [];
  const base = (id) => div().id(id).flex_none().flex().items_center().text_size(11.5).accessibility_label(`Open in ${E.editorName(m.id, extra)}`);
  const click = (e) => (m.busy ? e.text_color(t.dim) : e.cursor_pointer().on_click((_e, cx) => { cx.stop_propagation(); view.openEditor(target, cx); }));
  if (short) return [click(base(`ed-${key}`).h(20).rounded(4).text_color(t.muted).hover((s) => s.text_color(t.foreground)).tooltip(`${m.tip} Right-click for other editors.`)
    .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openEditorMenu(view, target); })).child(m.text)];
  return [h_flex().flex_none().items_center().rounded(5)
    .child(click(base(`ed-${key}`).h(24).pl(6).pr(3).rounded(5).text_color(t.muted).hover((s) => s.bg(t.selected).text_color(t.foreground)).tooltip(m.tip)).child(m.text))
    .child(div().id(`ed-${key}-more`).flex_none().h(24).px(4).flex().items_center().rounded(5).text_size(11.5).text_color(t.muted).cursor_pointer().hover((s) => s.bg(t.selected).text_color(t.foreground))
      .tooltip("Other editors, Copy path, Look again.").accessibility_label("Other editors").on_click((_e, cx) => { cx.stop_propagation(); openEditorMenu(view, target); }).child("▾"))];
}

// The menu's entries, for the copy whose menu it was (view.editorTarget): true when the command was one of them.
export function menuCommand(view, c, cx) {
  const [name, ...rest] = c.split(":"), arg = rest.join(":"), target = view.editorTarget;
  if (!name.startsWith("editor-")) return false;
  if (name === "editor-look") { cx.spawn(async (cx) => { await lookForEditors(true); cx.notify(); }); return true; }
  if (!target) return true; // another copy's menu
  view.editorTarget = null;
  if (name === "editor-use") {
    const r = roots.get(target.root) ?? E.gitLink(null, target.root), { choice, changed } = E.withChoice(shared(CHOICE), r.common, r.linked, arg);
    if (changed) setShared(CHOICE, choice); // every mod draws again: only when the choice is another one
    startOpen(target, cx, arg);
  } else if (name === "editor-main") startOpen({ root: target.main.path }, cx);
  else if (name === "editor-copy") cx.write_to_clipboard(target.file ? `${E.safeFile(target.root, target.file) ?? target.file}${target.line ? `:${target.line}` : ""}` : target.root);
  return true;
}
