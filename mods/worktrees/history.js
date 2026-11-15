// The history view: one checkout's commits as a drawn tree. A copy of the mod opened with props
// {history: <checkout path>, name, branch, slug, context} shows this instead of the panel (main.js).
// One row per commit: its lane on the left (a line per branch in a color of its own, a dot per commit, a bend where
// branches fork or merge), then branch and tag chips, the subject, hash, author and age. The readable view is the
// default: unmerged branches in full, plain merged history folded into "· 14 commits ·".
// Local only: one `git log` and one `git for-each-ref`, nothing is fetched or written.
// What to list and where each row draws is worked out in graph.js when the data or a choice changes, never in render.
import { div } from "gpui-kit";
import { h_flex, v_flex, v_virtual_list, VirtualListScrollHandle, Scrollbar, InputState, Input } from "gpui-base";
import { theme, exec, run, spaces, home, settings, readTextFile, nextCommand } from "herdr";
import * as M from "./model.js";
import * as G from "./graph.js";
import { prsNow, openPr, prWhere, openFolder } from "./hub.js";

const ROW = 26;        // every row's height
const MAX = 400;       // commits per load; "Load more" doubles it
const NARROW_PX = 560; // narrower: no hash, no author, lanes closer together
const MAX_LANES = 14;  // ponytail: lanes further right are cut off; a horizontal scroll if repos really get that wide
const MODES = [["branches", "Branches", "Every local branch against the base: unmerged work in full, merged history folded."],
  ["branch", "This branch", "The picked branch and the base it forked from."],
  ["all", "All commits", "Every commit of every branch, remote branch and tag, nothing folded."]];
const PALETTE = ["ansi1", "ansi2", "ansi3", "ansi4", "ansi5", "ansi6"]; // lane colors, by branch name
const TYPES = { feat: "ansi2", fix: "ansi1", docs: "ansi4", perf: "ansi5", refactor: "ansi6", test: "ansi3" }; // Conventional Commit types
// Chips are set in the terminal's monospace font with a width worked out from their text, so that a click's x
// position tells which chip it hit: rows of a virtual list cannot carry click handlers of their own.
const CHIP_PX = 11, CHAR_W = 6.7, CHIP_PAD = 14, GAP = 6;
const chipW = (text) => Math.ceil([...text].reduce((w, ch) => w + (ch.charCodeAt(0) > 0x2000 ? 1.6 : 1), 0) * CHAR_W) + CHIP_PAD;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const hhmm = (ms) => new Date(ms).toTimeString().slice(0, 5);
const day = (d) => `${MONTHS[d.getMonth()]} ${d.getDate()} ${d.getFullYear()} ${d.toTimeString().slice(0, 5)}`;
const tilde = (path) => (path.startsWith(`${home()}/`) ? `~${path.slice(home().length)}` : path);
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

export default class History {
  constructor(p, cx) {
    this.path = p.history;
    this.name = p.name ?? this.path.slice(this.path.lastIndexOf("/") + 1);
    this.picked = p.branch ?? null; // the branch "This branch" means, and one of the lanes drawn stronger
    this.slug = p.slug ?? null;     // owner/name, for PR marks
    this.context = p.context ?? null;
    this.mode = "branches";
    this.max = MAX;
    this.open = new Set();          // folds listed commit by commit
    this.filter = "";
    this.sel = -1;                  // the selected row
    this.pressX = 0;                // where in the list the last press was (see clickRow)
    this.detail = null;             // {hash, data} of the commit whose details show
    this.commits = []; this.nodes = []; this.lanes = { rows: [], width: 0 }; this.unmerged = new Set();
    this.refs = new Map();          // branch name -> {upstream, ahead, behind, gone, worktree, current}
    this.scroll = VirtualListScrollHandle.new();
    this.handle = cx.focus_handle();
    this.input = InputState.new({ placeholder: "Filter by branch or subject…" });
    this.input.on("change", (_e, cx) => { this.filter = this.input.value().trim().toLowerCase(); this.arrange(); cx.notify(); });
    this.input.on("submit", () => this.handle.focus());
    cx.spawn((cx) => this.load(cx));
    // Commands ("<mod>.h-…", for keys and scripts): h-mode:branches|branch|all, h-filter:<text>, h-select:<row | hash | branch>,
    // h-unfold:<n | all>, h-more, h-refresh, h-esc, h-branch:<name>. "focus" comes from pane.go.
    cx.spawn(async (cx) => { for (;;) { this.command(String(await nextCommand()), cx); cx.notify(); } });
    this.handle.focus();
  }

  git(args) {
    return exec("git", args, { cwd: this.path, timeout: 60000 }).catch((e) => ({ code: 1, stdout: "", stderr: String(e) }));
  }

  // Branches (one for-each-ref), the base branch, then the commits (one git log).
  async load(cx) {
    this.loading = true; cx.notify();
    const refs = await this.git(["for-each-ref", "refs/heads", `--format=${M.REF_FORMAT}`]);
    const card = refs.code === 0 ? M.branchCard(refs.stdout, { here: this.path }) : [];
    this.refs = new Map(card.map((r) => [r.name, r]));
    this.head = card.find((r) => r.current)?.name ?? null;
    // The base: origin's default branch as a local branch, else main or master, else origin's own.
    const link = M.gitLink(await readTextFile(`${this.path}/.git`).catch(() => null), this.path);
    const originHead = await readTextFile(`${link.common}/refs/remotes/origin/HEAD`).catch(() => null);
    const names = M.baseCandidates(originHead);
    this.base = names.find((b) => !b.startsWith("origin/") && this.refs.has(b)) ?? (originHead ? names.find((b) => b.startsWith("origin/")) : null) ?? null;
    const started = Date.now();
    const log = await this.git(G.logArgs(this.mode, { base: this.base, branch: this.picked ?? this.head, max: this.max }));
    this.gitMs = Date.now() - started;
    const why = (r, what) => `${what}: ${(r.stderr.trim().split("\n")[0] || `exit ${r.code}`).slice(0, 140)}`;
    if (log.code === 0) { const p = G.parseLog(log.stdout, this.max); this.commits = p.commits; this.more = p.more; this.error = null; }
    else { this.commits = []; this.more = false; this.error = why(log, "git log"); }
    // Without the branch list there is no base and no fold: say so rather than draw a poorer tree silently.
    if (refs.code !== 0 && !this.error) this.error = `${why(refs, "git for-each-ref")} · press ↻`;
    const onBase = (c) => (this.base?.startsWith("origin/") ? c.refs.remotes.includes(this.base) : c.refs.heads.includes(this.base));
    this.baseTip = this.commits.find(onBase)?.hash ?? null;
    this.loadedAt = Date.now(); this.loading = false;
    this.arrange();
    cx.notify();
  }

  // Which rows there are and where each one draws. Called when the commits, the mode, the filter or a fold changed.
  arrange() {
    const started = Date.now(), keep = this.nodes[this.sel]?.id;
    const visible = G.shown(this.commits, { base: this.baseTip, all: this.mode === "all", filter: this.filter });
    this.nodes = G.plan(this.commits, visible, this.open, this.filter ? 1 : undefined); // a filter folds every commit that does not match
    this.lanes = G.lanes(this.nodes, { base: this.baseTip, colors: G.palette([...this.refs.keys()]) });
    this.sel = keep ? this.nodes.findIndex((n) => n.id === keep) : -1;
    // Commits the base does not have yet: their subjects stay bright, merged history is dimmed.
    const merged = this.baseTip ? G.reachable(this.commits, this.baseTip) : null;
    this.unmerged = new Set(merged ? this.commits.filter((c) => !merged.has(c.hash)).map((c) => c.hash) : []);
    this.layoutMs = Date.now() - started;
  }

  setMode(mode, cx) {
    if (mode === this.mode) return;
    this.mode = mode; this.open = new Set(); this.max = MAX;
    cx.spawn((cx) => this.load(cx));
  }

  command(c, cx) {
    if (c === "focus") return this.handle.focus();
    const [name, arg] = [c.split(":")[0], c.split(":").slice(1).join(":")];
    const folds = () => this.nodes.filter((n) => n.fold).map((n) => n.id);
    if (name === "h-mode" && MODES.some(([k]) => k === arg)) this.setMode(arg, cx);
    else if (name === "h-filter") { this.input.set_value(arg); this.filter = arg.trim().toLowerCase(); this.arrange(); }
    else if (name === "h-select") {
      const i = /^\d+$/.test(arg) ? +arg : this.nodes.findIndex((n) => n.commit && (n.id.startsWith(arg) || n.commit.refs.heads.includes(arg)));
      if (this.nodes[i]) this.pick(i, cx);
    }
    else if (name === "h-unfold") { for (const id of arg === "all" ? folds() : [folds()[+arg || 0]].filter(Boolean)) this.open.add(id); this.arrange(); }
    else if (name === "h-more") this.loadMore(cx);
    else if (name === "h-refresh") cx.spawn((cx) => this.load(cx));
    else if (name === "h-esc") this.escape();
    else if (name === "h-branch" && this.refs.has(arg)) this.openBranch(arg, cx);
  }

  loadMore(cx) { this.max *= 2; cx.spawn((cx) => this.load(cx)); }

  // A row's click or Enter: a fold opens, a commit shows its details (one `git show --numstat`).
  pick(i, cx) {
    const node = this.nodes[i];
    if (!node) return;
    this.sel = i;
    if (node.fold) { this.open.add(node.id); this.arrange(); this.sel = Math.min(i, this.nodes.length - 1); return; }
    if (this.detail?.hash === node.id) return;
    this.detail = { hash: node.id, data: null };
    cx.spawn(async (cx) => {
      const r = await this.git(["show", "--no-color", "--numstat", "--format=%an%x1f%aI%x1f%B%x1e", "--end-of-options", node.id, "--"]);
      if (this.detail?.hash !== node.id) return;
      this.detail.data = r.code === 0 ? G.parseShow(r.stdout) : { author: "", date: "", message: "git show failed here.", files: [] };
      cx.notify();
    });
  }

  escape() {
    if (this.detail) this.detail = null;
    else if (this.filter) { this.input.set_value(""); this.filter = ""; this.arrange(); }
    else this.sel = -1;
  }

  key(e, cx) {
    const k = e.key, last = this.nodes.length - 1;
    if (k === "down" || k === "up") {
      this.sel = Math.max(0, Math.min(last, this.sel + (k === "down" ? 1 : -1)));
      if (this.vis && (this.sel < this.vis.start + 1 || this.sel > this.vis.end - 2)) this.scroll.scroll_to_item(this.sel, "center");
      if (this.detail && this.nodes[this.sel]?.commit) this.pick(this.sel, cx); // the open details follow the selection
    } else if (k === "enter" && this.sel >= 0) this.pick(this.sel, cx);
    else if (k === "escape") this.escape();
    else return;
    cx.stop_propagation();
    cx.notify();
  }

  // A branch chip's click: the space on the folder where that branch is checked out, else on this checkout.
  openBranch(name, cx) {
    const r = this.refs.get(name);
    openFolder(r?.current ? this.path : r?.worktree ?? this.path, this.context, cx);
  }

  openDiff(hash) {
    run("pane.split", { direction: "down", argv: ["git", "-C", this.path, "-c", "core.pager=less -+F -R", "show", hash] });
  }

  // ---- drawing ---------------------------------------------------------------------------------------------------

  // A lane's color: the base is plain, every other lane has one of six (graph.js gives the index).
  tint(color, t) { return color < 0 ? t.muted : t[PALETTE[color]]; }
  // A branch's color: its lane's, or the one its name would get when it has no lane of its own.
  laneColor(name, t) { return this.tint(this.lanes.colors?.get(name) ?? G.colorOf(name), t); }

  // The lanes of one row: absolutely placed lines, bends with a round corner, and the commit's dot.
  graph(row, node, t, u) {
    const mid = ROW / 2, x = (lane) => 8 + lane * u.lane, R = Math.min(8, u.lane - 3);
    const pen = (e) => [this.tint(e.color, t), u.strong.has(e.name) ? 3 : 2];
    const vline = (lane, top, height, [c, w]) => div().absolute().left(x(lane) - w / 2).top(top).w(0).h(height).border_l(w).border_color(c);
    const els = [];
    for (const th of row.through) els.push(vline(th.lane, 0, ROW, pen(th)));
    for (const tp of row.top) {
      const [c, w] = pen(tp);
      if (tp.from === row.lane) { els.push(vline(row.lane, 0, mid, [c, w])); continue; }
      // down the other lane to this row's middle, then across to the dot: the corner is on the other lane's side
      const a = x(tp.from), b = x(row.lane);
      const box = div().absolute().left(Math.min(a, b) - w / 2).top(0).w(Math.abs(a - b) + w).h(mid + w / 2).border_b(w).border_color(c);
      els.push(a < b ? box.border_l(w).rounded_bl(R) : box.border_r(w).rounded_br(R));
    }
    for (const bt of row.bottom) {
      const [c, w] = pen(bt);
      if (bt.to === row.lane) { els.push(vline(row.lane, mid, ROW - mid, [c, w])); continue; }
      // from the dot across to the other lane, then down: the corner is on the other lane's side
      const a = x(row.lane), b = x(bt.to);
      const box = div().absolute().left(Math.min(a, b) - w / 2).top(mid - w / 2).w(Math.abs(a - b) + w).h(ROW - mid + w / 2).border_t(w).border_color(c);
      els.push(b > a ? box.border_r(w).rounded_tr(R) : box.border_l(w).rounded_tl(R));
    }
    const c = this.tint(row.color, t), at = x(row.lane);
    if (node.fold) els.push(div().absolute().left(at - 3).top(mid - 6).w(6).h(12).rounded(3).border(1).border_color(t.dim).bg(t.background));
    else if (node.commit.refs.head) els.push(div().absolute().left(at - 6).top(mid - 6).size(12).rounded_full().border(2).border_color(t.foreground).bg(c));
    else if (node.parents.length > 1) els.push(div().absolute().left(at - 4.5).top(mid - 4.5).size(9).rounded_full().border(2).border_color(c).bg(t.background));
    else els.push(div().absolute().left(at - 4).top(mid - 4).size(8).rounded_full().bg(c));
    return div().relative().flex_none().w(u.graphW).h(ROW).overflow_hidden().children(els);
  }

  // Branch, tag and HEAD marks of a commit as data: [{kind, name, text, tip, w, x0, x1, pr}], x from the row's left
  // edge. Never wrapped: long names lose their middle, the full one is in the tooltip and in the details.
  chipSpecs(node, u) {
    const all = G.chips(node.commit.refs), out = [];
    for (const ch of all.slice(0, u.chips)) {
      if (ch.kind === "branch") {
        const r = this.refs.get(ch.name);
        const state = ch.synced.length ? `same commit as ${ch.synced.map((s) => `${s}/${ch.name}`).join(", ")}` : !r?.upstream ? "no upstream" : r.gone ? "its upstream is gone" : r.ahead ? `${plural(r.ahead, "commit")} not pushed` : r.behind ? `${plural(r.behind, "commit")} to pull` : "";
        out.push({ ...ch, text: `${ch.head ? "● " : ""}${G.middle(ch.name, u.nameMax)}${ch.synced.length ? (u.narrow ? " ⇄" : ` ⇄ ${ch.synced[0]}`) : ""}${r?.ahead ? ` ↑${M.cap(r.ahead)}` : ""}${r?.worktree ? " ⧉" : ""}`,
          tip: [ch.name, ch.head ? "checked out here" : "", state, r?.worktree ? `checked out in ${tilde(r.worktree)}` : "", "click: go to its space"].filter(Boolean).join(" · ") });
        const pr = M.prFor(u.prs, this.slug, ch.name);
        if (pr) out.push({ kind: "pr", name: ch.name, pr, text: M.prLabel(pr), tip: `Pull request ${pr.repo}#${pr.number} (${pr.state}). Click: ${prWhere(pr)}.` });
      } else if (ch.kind === "remote") out.push({ ...ch, text: G.middle(ch.name, u.nameMax), tip: `${ch.name} · a remote branch, as of the last fetch` });
      else if (ch.kind === "tag") out.push({ ...ch, text: `◆ ${G.middle(ch.name, u.nameMax)}`, tip: `Tag ${ch.name}` });
      else out.push({ ...ch, text: "HEAD", tip: "HEAD is detached at this commit." });
    }
    if (all.length > u.chips) out.push({ kind: "more", name: "", text: `+${all.length - u.chips}`, tip: all.slice(u.chips).map((ch) => ch.name).join(", ") });
    let x = u.graphW + GAP;
    for (const c of out) { c.w = chipW(c.text); c.x0 = x; c.x1 = x + c.w; x = c.x1 + GAP; }
    return out;
  }

  chip(spec, id, t, u) {
    const el = div().id(id).flex_none().w(spec.w).h(18).flex().items_center().justify_center().rounded(9).font_family(u.mono).text_size(CHIP_PX).whitespace_nowrap().overflow_hidden().tooltip(spec.tip);
    if (spec.kind === "branch") { const strong = spec.head || u.strong.has(spec.name); return el.border(1).border_color(this.laneColor(spec.name, t)).text_color(strong ? t.foreground : t.muted).when(strong, (e) => e.font_semibold()).child(spec.text); }
    if (spec.kind === "pr") return el.text_color({ open: t.ansi2, draft: t.muted, merged: t.ansi5, closed: t.dim }[spec.pr.state] ?? t.muted).child(spec.text);
    if (spec.kind === "tag") return el.bg(t.surface).text_color(t.muted).child(spec.text);
    if (spec.kind === "head") return el.border(1).border_color(t.foreground).text_color(t.foreground).font_semibold().child(spec.text);
    return el.text_color(t.dim).child(spec.text);
  }

  // A click on a row (the list reports the row, the press before it where): a branch chip goes to that branch's
  // space, a PR mark opens the PR, anything else picks the row.
  clickRow(key, cx) {
    const i = this.nodes.findIndex((n) => n.id === key), node = this.nodes[i];
    if (!node) return;
    this.handle.focus();
    const hit = node.commit && this.u ? this.chipSpecs(node, this.u).find((c) => this.pressX >= c.x0 && this.pressX < c.x1) : null;
    if (hit?.kind === "branch") { this.sel = i; this.openBranch(hit.name, cx); }
    else if (hit?.kind === "pr") { this.sel = i; openPr(hit.pr, cx); }
    else this.pick(i, cx);
    cx.notify();
  }

  row(node, i, t, u) {
    const sel = i === this.sel, lanes = this.graph(this.lanes.rows[i], node, t, u);
    const el = h_flex().id(`h-${node.id}`).h(ROW).w_full().pr(10).gap(GAP).items_center().when(sel, (e) => e.bg(t.selected)).hover((s) => s.bg(sel ? t.selected : t.hover)).child(lanes);
    if (node.fold) return el.tooltip("Plain history without a branch or tag on it. Click: list these commits.")
      .child(div().text_size(11.5).text_color(t.dim).child(`· ${plural(node.fold, "commit")} ·`));
    const c = node.commit, s = G.conventional(c.subject);
    return el
      .children(this.chipSpecs(node, u).map((spec, k) => this.chip(spec, `c-${node.id}-${k}`, t, u)))
      .child(h_flex().flex_1().min_w(0).gap(5).text_size(12.5).overflow_hidden()
        .when(Boolean(s.lead), (e) => e.child(div().min_w(0).truncate().text_color(t[TYPES[s.type]] ?? t.dim).child(s.lead)))
        .child(div().flex_1().min_w(0).truncate().text_color(!this.baseTip || c.hash === this.baseTip || this.unmerged.has(c.hash) ? t.foreground : t.muted).child(s.rest)))
      .when(!u.narrow, (e) => e
        .child(div().flex_none().w(58).text_size(11).text_color(t.dim).child(c.hash.slice(0, 7)))
        .child(div().id(`a-${node.id}`).flex_none().w(24).text_size(11).text_color(t.dim).tooltip(c.author).child(G.initials(c.author))))
      .child(div().flex_none().w(34).text_size(11).text_color(t.dim).text_right().child(M.age(c.at, u.now)));
  }

  details(t) {
    const d = this.detail, data = d.data, c = this.commits.find((x) => x.hash === d.hash);
    const pill = (id, text, tip, click) => div().id(id).flex_none().px(8).h(24).flex().items_center().rounded(5).border(1).border_color(t.border).text_size(11.5).text_color(t.muted)
      .hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip(tip).on_click((_e, cx) => { click(); cx.notify(); }).child(text);
    const [subject, ...rest] = (data?.message || c?.subject || "").split("\n");
    const body = rest.join("\n").trim().split("\n").filter((l, i, a) => l || a.length > 1).slice(0, 6);
    const when = data?.date ? day(new Date(data.date)) : "";
    const FILES = 10; // ponytail: the first files and a count; the whole change is one click away ("Open diff")
    return v_flex().id("h-details").flex_none().p(12).gap(6).border_t(1).border_color(t.border).bg(t.surface)
      .child(h_flex().gap(8).items_start()
        .child(div().flex_1().min_w(0).text_size(13).font_semibold().text_color(t.foreground).child(subject))
        .child(pill("h-diff", "Open diff ↗", "Open `git show` for this commit in a terminal pane below.", () => this.openDiff(d.hash)))
        .child(pill("h-close", "✕", "Close the details (Esc).", () => { this.detail = null; }).accessibility_label("Close details")))
      .child(div().text_size(11.5).text_color(t.muted).child([d.hash.slice(0, 10), data?.author ?? c?.author, when].filter(Boolean).join(" · ")))
      .when(body.some(Boolean), (e) => e.child(v_flex().text_size(12).text_color(t.muted).children(body.map((l) => div().min_h(16).child(l)))))
      .child(!data ? div().text_size(11.5).text_color(t.dim).child("Reading the commit…")
        : v_flex().gap(1).text_size(11.5)
          .children(data.files.slice(0, FILES).map((f) => h_flex().gap(8).min_h(18).items_center()
            .child(div().flex_none().w(40).text_right().text_color(t.ansi2).child(f.add === null ? "bin" : `+${f.add}`))
            .child(div().flex_none().w(40).text_right().text_color(t.ansi1).child(f.del === null ? "" : `−${f.del}`))
            .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(f.path))))
          .when(data.files.length > FILES, (e) => e.child(div().pl(96).text_color(t.dim).child(`+${data.files.length - FILES} more files`)))
          .when(!data.files.length, (e) => e.child(div().text_color(t.dim).child("No file changes (a merge, or an empty commit)."))));
  }

  render(cx) {
    const t = theme();
    const narrow = (this.width ?? Infinity) < NARROW_PX, lane = narrow ? 10 : 14;
    const focusBranch = spaces().find((s) => s.active)?.branch ?? null; // the shown space's branch
    const u = this.u = {
      narrow, lane, now: Date.now(), prs: prsNow(this), mono: settings()?.font_family ?? "JetBrains Mono",
      graphW: Math.min(Math.max(this.lanes.width, 1), MAX_LANES) * lane + 12,
      strong: new Set([this.head, this.picked, focusBranch].filter(Boolean)),
      // a branch chip may take up to about a third of the width: the subject keeps the larger share
      nameMax: Math.max(16, Math.min(44, Math.floor(((this.width ?? 900) * (narrow ? 0.36 : 0.3)) / CHAR_W))), chips: narrow ? 2 : 3,
    };
    const nodes = this.nodes;
    const seg = h_flex().flex_none().p(2).gap(2).rounded(7).border(1).border_color(t.border).bg(t.surface)
      .children(MODES.map(([k, label, tip]) => div().id(`h-seg-${k}`).px(8).h(24).flex().items_center().rounded(5).text_size(11.5).whitespace_nowrap()
        .tooltip(k === "branch" ? `${tip} Now: ${this.picked ?? this.head ?? "none"}.` : tip)
        .bg(this.mode === k ? t.selected : t.surface).text_color(this.mode === k ? t.foreground : t.muted)
        .on_click((_e, cx) => { this.setMode(k, cx); cx.notify(); }).child(k === "branch" && !narrow && (this.picked ?? this.head) ? `This branch · ${G.middle(this.picked ?? this.head, 22)}` : label)));
    const state = this.loading ? "reading git…"
      : this.error ? this.error
      : this.loadedAt ? [`as of ${hhmm(this.loadedAt)}`, this.more ? `the newest ${this.commits.length} commits` : plural(this.commits.length, "commit"), this.base ? `base ${this.base}` : "no main branch found", "no fetch"].join(" · ") : "";
    const filter = h_flex().id("h-filter").flex_1().min_w(80).h(26).px(8).items_center().rounded(6).border(1).border_color(t.border).bg(t.surface)
      .child(Input.new(this.input).flex_1().h_full().text_size(12).text_color(t.foreground));
    const icon = (id, text, tip, click) => div().id(id).flex_none().px(6).h(24).flex().items_center().justify_center().rounded(5).text_size(12).text_color(t.muted)
      .hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip(tip).on_click((_e, cx) => { click(cx); cx.notify(); }).child(text);
    return v_flex().id("history").track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx))
      .on_size_change((size, cx) => { this.width = size.width; cx.notify(); })
      .size_full().min_h(0).bg(t.background).text_size(13)
      .child(v_flex().flex_none().p(10).gap(8).border_b(1).border_color(t.border)
        .child(h_flex().gap(8).items_center()
          .child(div().min_w(0).truncate().text_size(13).font_semibold().text_color(t.foreground).child(this.name))
          .child(seg)
          .child(narrow ? div().flex_1() : filter)
          .when(this.more, (e) => e.child(icon("h-more", "Load more", `Only the newest ${this.commits.length} commits are listed. Click: twice as many.`, (cx) => this.loadMore(cx))))
          .child(icon("h-refresh", this.loading ? "…" : "↻", `Read the history again. Local only: nothing is fetched.${this.gitMs !== undefined ? ` Last time: git ${this.gitMs} ms, layout ${this.layoutMs} ms.` : ""}`, (cx) => cx.spawn((cx) => this.load(cx))).accessibility_label("Refresh history")))
        .when(narrow, (e) => e.child(filter))
        .child(div().text_size(11).text_color(this.error ? t.blocked : t.dim).truncate().child(state)))
      .child(div().id("h-list").flex_1().min_h(0).relative()
        .on_mouse_down("left", (e) => { this.pressX = e.local_position?.x ?? 0; })
        .when(!nodes.length && !this.loading, (e) => e.child(div().p(14).text_size(12).text_color(t.dim).child(this.error ? "No history to show." : this.filter ? "No commit matches." : "No commits yet.")))
        .child(v_virtual_list("h-rows", nodes.length, ROW, (i) => nodes[i].id, (range) => {
          this.vis = range;
          return nodes.slice(range.start, range.end).map((node, k) => this.row(node, range.start + k, t, u));
        }).track_scroll(this.scroll).on_item_click((key, cx) => this.clickRow(key, cx)).size_full())
        .child(Scrollbar.vertical("h-rows").absolute().inset_0()))
      .when(Boolean(this.detail), (e) => e.child(this.details(t)));
  }
}
