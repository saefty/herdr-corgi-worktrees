# Corgi · Worktrees for Herdr

<h3 align="center">See which of your git checkouts hold work that exists only on this machine, and read a repo's history as a drawn tree: branches as colored lanes, long names kept readable, merged history folded away.</h3>

<p align="center"><img src="preview.png" width="88%" alt="A repo's history as a drawn tree next to the Herdr sidebar" /></p>

<p align="center"><sub>✓&nbsp;Free,&nbsp;MIT &nbsp;·&nbsp; ✓&nbsp;Runs&nbsp;locally,&nbsp;never&nbsp;fetches &nbsp;·&nbsp; ✓&nbsp;herdr-app&nbsp;0.1.15+</sub></p>

Part of [Corgi](https://github.com/saefty/herdr-corgi), a set of Herdr mods that plug into each other.

Two views for Herdr. A side panel over every git checkout under your code folders, including the worktrees agents
work in. And a history view of one repo, drawn instead of typed: no `git log --graph` in a terminal with lines made
of characters and branch names that wrap. Both read git on your disk and nothing else: they never fetch, and they
never write to a repo.

## Use cases

- **Before you close the laptop.** "Not pushed" lists every repo with commits that are only here, the newest
  first, with the branch and how many commits. A branch that was never pushed counts too.
- **An agent finished in a worktree.** Agents' worktrees are listed with the repo they belong to, so the three
  commits on `agent/fix-timeouts` don't stay behind when you remove the worktree.
- **Where was I this week?** "Changed this week" has the checkouts with uncommitted changes to tracked files from
  the last seven days. Old leftovers and folders full of untracked files are folded away below, with a count and
  the reason.
- **What can go?** Open a row and its branch card shows every local branch against main: ahead, behind, its age,
  its worktree, its pull request. "merged, can go" appears only with proof.
- **Go there.** A click on a row goes to the space that is open on that checkout, or opens one.
- **What happened on this branch?** "History ↗" opens the repo's history as a tree. Unmerged branches are shown
  commit by commit, each in its own color; the main line is the left lane; plain merged history is folded into
  "· 14 commits ·" until you click it.

## Screenshots

![The history view: every unmerged branch against main, merged history folded](docs/screenshots/history.png)

![A commit picked: its message, author, date and changed files](docs/screenshots/history-details.png)

![All commits: merged side branches drawn with their bends](docs/screenshots/history-all.png)

![This branch: one branch and the base it forked from](docs/screenshots/history-branch.png)

![Filtered by "checkout"](docs/screenshots/history-filter.png)

![The history view in a narrow pane: no hash, no author, lanes closer together](docs/screenshots/history-narrow.png)

![The list at 380 px: Not pushed, Changed this week, and the folded rest](docs/screenshots/needs-me.png)

![A repo's branch card: bars against main, a stack of two pull requests, a merged branch](docs/screenshots/branch-card.png)

![Every checkout by folder](docs/screenshots/all.png)

![One of two contexts shown](docs/screenshots/context.png)

## Features

- Three lists: **Not pushed** (commits only on this machine), **Changed this week** (tracked files touched in the
  last 7 days), **Older or untracked only** (folded: older changes, only untracked files, only behind, only a
  stash, no remote at all). One sentence at the top says how many of each.
- Rows keep the repo's name whole and say the branch, the pull request, the age and, with contexts, the context.
  Marks: `↑3` commits not pushed, `↓2` to pull (as of the last fetch), `●4` changed tracked files, `?7`
  untracked, `⚑1` stash entries, `◧` a space is open there.
- A repo and its worktrees count as one repo; a repo with many unpushed worktrees shows its newest and one line
  for the rest.
- The branch card (▸ on a row): one `git for-each-ref` for that repo only. Branches stacked on each other are
  indented. "History ↗" opens the history view with the row's branch picked, "Open space ↗" goes there.
- The history view: one row per commit. On the left a lane per branch in a color of its own (always the same for
  that branch), a dot per commit, a round bend where branches fork and merge; HEAD and the picked branch are drawn
  stronger. Then chips for branches and tags (`feat/x ⇄ origin` when the remote branch is on the same commit, the
  pull request, `⧉` for a branch checked out in another worktree), the subject with its Conventional Commit type
  tinted, the short hash, the author's initials and the age. Long branch names lose their middle, never their ends,
  and never wrap; the full name is in the tooltip.
- Three ways to look: **Branches** (every local branch against the base, merged history folded), **This branch**
  (one branch and the base), **All commits** (everything, nothing folded). A filter narrows to commits whose
  subject or branch names contain the text.
- A repo with more branches side by side than fit sets its lanes closer together; beyond sixteen the lane area
  rolls sideways ("lanes 1–16 of 23 ◂ ▸"). Nothing is cut off.
- "History ↗" for a repo whose history is already open goes to that tab instead of opening another.
- A click on a commit shows its message, author, date and changed files with their line counts; "Open diff ↗" runs
  `git show` in a terminal pane. A click on a branch chip goes to that branch's space or worktree, on a pull
  request mark to the pull request. Arrow keys move, Enter opens, Esc closes.
- The history lists the newest 400 commits at first ("Load more" doubles it), from one `git log`.
- "All" lists every checkout by folder, clean ones included.
- Cheap by design. Starting a process is what costs time (a quarter of a second each on some machines), so git
  is asked as rarely as possible: one small helper reads from files which checkouts changed since their last
  `git status`, one process for all of them, and git runs only for those. What was known is kept across app
  starts, so the list is there at once. All checkouts are checked when the panel opens and on ↻; while it stays
  open, only the ones in use (a space or a terminal in them, or changes from the last day) every five minutes; a
  watch on each `.git` reports commits and pushes right away.
- Other mods can add pull request marks, split the list by context (work and personal, say), read the number of
  repos that are not pushed for a button, and find the listed checkouts in Go to. Without any of them the panel
  works on its own.

## Works with

Worktrees, [Go to](https://github.com/saefty/herdr-corgi-goto) and [PR review](https://github.com/saefty/herdr-corgi-pr-review) each work alone. Installed together, they plug into each other:

- With **Go to**, the checkouts that need a look show up there ("orbit-api · feat/login-flow, 3 not pushed") and
  Enter takes you to the space.
- With **PR review**, a click on a pull request mark opens that PR in the review. The marks themselves come from a
  provider: any mod that knows your pull requests can publish them.
- **Your own mod** can publish pull requests, tell which checkout belongs to which of your setups, and show the
  count in a bar. [PROVIDERS.md](mods/worktrees/PROVIDERS.md) has the shapes.

## What's in here

- `mods/worktrees/`: the mod. `main.js` is the panel and `history.js` the history view; `model.js`, `status.js`
  and `graph.js` (lanes, folds) are the logic without any UI, each with its tests. `probe.py` is the helper
  that reads which checkouts changed.
- `RECIPE.md`: the brief to build it from scratch.
- `demo/`: an invented setup for the screenshots.

## Requirements

A mod can't install programs. Everything the panel runs is on a developer machine already:

| Program | Needed for | macOS | Linux |
|---|---|---|---|
| `git` | everything: status, branches, the history pane | `brew install git` (or Xcode's) | `sudo apt install git` |
| `git` 2.41 or newer (optional) | the bars in the branch card (ahead of and behind main); an older git lists the branches without them | `brew upgrade git` | your distribution's newer package |
| `find` | finding checkouts | part of macOS | part of findutils |
| `python3` (optional, standard library only) | `probe.py`, the helper that tells from files which checkouts changed. Without it every check starts one `git status` per checkout (and one `stat`): the same list, but about a quarter of a second per checkout on machines where starting a process is slow | part of Xcode's tools, or `brew install python` | `sudo apt install python3` |
| `less` (optional) | "Open diff ↗" in the history view: git's pager keeps the pane open; without it the pane closes at once | part of macOS | `sudo apt install less` |

It needs no network, no `gh` and no login. Pull request marks come from other mods, not from a program here.
The demo scripts (`demo/`) also use `node` and `ffmpeg`; the mod doesn't.

## Install in three steps

<table>
<tr>
<td align="center" valign="top" width="33%"><h3>1</h3><b>Add the mod</b><br /><sub>With <a href="https://github.com/saefty/herdr-corgi">Corgi</a>: <code>corgi enable worktrees</code>. By hand: copy <code>mods/worktrees</code> to <code>~/.config/herdr-app/mods/</code>. There are no keys to merge.</sub></td>
<td align="center" valign="top" width="33%"><h3>2</h3><b>Say where your code is</b><br /><sub>It looks in <code>~/code</code>, <code>~/src</code>, <code>~/projects</code> and <code>~/dev</code>. Other folders: <code>roots</code> in <code>worktrees.config.json</code> (below).</sub></td>
<td align="center" valign="top" width="33%"><h3>3</h3><b>Open it</b><br /><sub><code>herdr-app do mod.open --name worktrees</code> opens it as a window. To dock it, add a block to a layout of yours (below).</sub></td>
</tr>
</table>

Or tell your agent: `Read ~/.config/herdr-app/AGENTS.md, then add this mod: https://github.com/saefty/herdr-corgi-worktrees/tree/main`

By hand, step by step: copy `mods/worktrees` to `~/.config/herdr-app/mods/`, then run
`herdr-app check ~/.config/herdr-app/mods/worktrees`. The mod docks nowhere by itself.

**As a window:** bind a free key of yours to `mod.open:worktrees` in `~/.config/herdr-app/keys.json`. The same key
closes it. This repo ships no key, so nothing of yours is rebound. Use the window or a docked block, not both:
each copy checks the repos on its own.

**Docked:** add `{ "id": "worktrees", "type": "block", "content": { "mod": "worktrees" } }` to a layout you own.
In a copy of Herdr's main layout (`herdr-app do layout.clone '{"name":"main","as":"mine"}'`) the right column's
stack `panel-body` is the place: add the block to its `children`, then show it with
`herdr-app do layout.select --stack panel-body --child worktrees` and `herdr-app do layout.show --id panel`.
The panel is made for 380 px and works from about 280 px.

## Settings

`~/.config/herdr-app/worktrees.config.json` (optional; these are the defaults):

```json
{
  "roots": ["~/code", "~/src", "~/projects", "~/dev"],
  "worktreeRoots": ["~/.herdr/worktrees"],
  "prune": ["node_modules", "build", "dist", "target", ".venv", ".terraform"],
  "depth": 4,
  "max": 500,
  "weekDays": 7,
  "goto": true
}
```

`roots` are the folders searched for git checkouts and `depth` how deep. `worktreeRoots` are folders whose
checkouts are marked "agent worktree" (the default is where Herdr puts them). `prune` are folder names never
entered. `max` caps the list, `weekDays` is what "this week" means, and `goto: false` keeps the checkouts out of
Go to. After a change press ↻ in the panel.

## Customize

Without touching code:

- **Where it looks:** `roots`, `depth` and `prune` in `worktrees.config.json`.
- **What "this week" means:** `weekDays`.
- **Keys:** every click has a command (`worktrees.refresh`, `worktrees.show:all`, `worktrees.expand:<repo>`, …);
  the list is in [PROVIDERS.md](mods/worktrees/PROVIDERS.md#4-commands).

Changed the code itself? Your edits survive `corgi update`: Corgi merges your version, the old release and the new
one. `corgi diff worktrees` shows what you changed.

## What it does not do

- It never runs `git fetch`. "Behind" and a gone upstream are as fresh as your last fetch, and the panel says so.
- It never writes: no push, commit, stash or branch delete. You act in the repo's space.
- The history view is for reading: no checkout, rebase or cherry-pick from it. A commit git did not list (beyond
  "Load more") leaves its lane open at the bottom.
- "Not pushed" looks at the branch each checkout has checked out. Other branches with local commits show in the
  branch card.
- The count for a bar is live only after the panel was shown once since the app started.
- A checkout nobody uses is checked when the panel opens and on ↻, not in between: the header says "as of 13:40
  (all 13:05)" then.
- The helper does not see one thing: a new untracked file two or more folders below any tracked folder, inside a
  folder that existed before and held only ignored files. Shift-click on ↻ asks git for every checkout.

## Tests

`node --test mods/worktrees/test_model.mjs mods/worktrees/test_graph.mjs` and `python3 mods/worktrees/test_probe.py`

## For mod authors

How to publish pull requests, contexts and read the count from your own mod: [PROVIDERS.md](mods/worktrees/PROVIDERS.md).

## License

MIT
