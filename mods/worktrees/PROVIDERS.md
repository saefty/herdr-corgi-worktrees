# Worktrees: the plug-in contract (version 1)

The rules every mod in the herdr-corgi set shares (announcing, requests, providers, the context hook,
versions) are in [CONVENTIONS.md](https://github.com/saefty/herdr-corgi/blob/main/CONVENTIONS.md). This page has
what is specific to this mod.

Worktrees works on its own: it reads git and nothing else. Everything here is optional. Other mods add to it
through shared state only, it never reads another mod's files, and a mod that writes these keys works without
Worktrees. Load order doesn't matter: the keys are read on every render.

Worktrees sets `worktrees.api = {version: 1}` when it starts.

## 1. Pull requests: `worktrees.prs.<provider>`

A provider tells which pull request belongs to which branch. Worktrees fetches nothing itself: without a provider
there are no PR marks, and that is not an error.

```js
const p = shared("worktrees.providers") ?? [];
if (!p.includes("mymod")) setShared("worktrees.providers", [...p, "mymod"]);
setShared("worktrees.prs.mymod", {
  at: Date.now(),                       // when this list was true (shown as "PRs as of 10:05")
  run: [["layout.switch", { name: "review" }], ["mymod.show:{repo}#{number}", {}]], // optional: a click, see below
  prs: [{
    repo: "octo/bookshelf",             // owner/name, as in the checkout's origin URL on github.com
    branch: "feat/due-reminders",       // the PR's head branch
    number: 12,
    state: "open",                      // "open" | "draft" | "merged" | "closed"
    url: "https://github.com/octo/bookshelf/pull/12", // optional: what a click opens
    base: "main",                       // optional: the branch it targets (draws stacks in the branch card)
    headSha: "9f2c…",                   // optional: the PR's head commit (see "merged, can go")
    updatedAt: "2026-11-14T10:00:00Z",  // optional: breaks ties between two PRs from one branch
    run: [["mymod.show:12", {}]],       // optional: this PR's own click, instead of the provider's
  }],
});
```

- A checkout shows the mark of the PR whose `repo` is its origin and whose `branch` is its checked-out branch. In
  the branch card every local branch gets its mark.
- Several providers are merged. Of several PRs from one branch, the open (or draft) one wins, else the one with
  the latest `updatedAt`. "PRs as of" shows the oldest `at` among the providers.
- **A click on a mark** runs the PR's `run`, else the provider's with `{url}`, `{repo}`, `{number}` and `{branch}`
  filled in: app commands in order, 150 ms apart, so a command that shows a panel lands before one that talks
  to it. Without any `run`: when the PR review mod is installed (`review.layout` is set), the PR is
  handed to it through `pr.goto` (`{url}`, its PROVIDERS.md section 3); else `url` opens in the browser.
- **"merged, can go"** in the branch card needs proof: the branch's PR is `merged` and the branch still is that
  PR's head (`headSha` equals the branch's commit, or no `headSha` was given), or git says the upstream branch is
  gone. Ancestry is never used, because a squash merge leaves the branch unmerged by ancestry.
- Keep the list small: every shared value is saved and re-read by all mods. Open PRs and the ones merged in the
  last weeks are enough.

## 2. Contexts: `goto.context` (read only)

When a mod owns contexts (profiles, clients, accounts) and publishes the hook from
[Go to's PROVIDERS.md, section 3](https://github.com/saefty/herdr-corgi-goto/blob/main/mods/goto/PROVIDERS.md#3-context-hook-gotocontext),
Worktrees uses these fields and ignores the rest:

| Field | Use |
|---|---|
| `folders` `[[prefix, id]]` | a checkout's context: the longest prefix that holds it (case-insensitive, `~` allowed). A worktree asks for the repo it belongs to first. |
| `remotes` `[[regex, id]]` | else the first pattern that matches its origin URL |
| `current` | when set, only that context's checkouts are listed and offered to Go to. A checkout of no context is left out then, so one setup never shows another's repos. |
| `labels`, `colors` | the word at the end of a row, shown while `current` is not set |
| `request`, `layouts` | opening a space for a checkout that has a context writes `{context, run, at}` to `request` instead of running the commands, when the hook listens in the shown layout |

Without the hook there are no contexts: everything is listed, rows carry no context word, and commands run directly.

## 3. What Worktrees publishes

| Key | Shape | When |
|---|---|---|
| `worktrees.api` | `{version: 1}` | at start |
| `worktrees.count` | `{total, contexts: {<id>: n}, none, at}` | after every full pass and whenever a count changes; confirmed at least every 30 minutes |
| `goto.items.worktrees` | Go to items, see below | with Go to installed (`goto.api`) and the `goto` setting on |

`worktrees.count` is how many repos have commits that exist only on this machine: ahead of their upstream, or on a
branch that was never pushed. A repo and its worktrees count once. `total` is all of them, `contexts[id]` those of
one context, `none` those of no context. A bar that shows the number reads `total`, or `contexts[current]` when it
shows one context. It holds numbers only, no names.

`at` says the count is alive. A mod's copy starts the first time its block is shown, so after an app start nothing
counts until the panel was opened once; a reader should drop a count whose `at` is older than about 45 minutes
rather than show a number from an earlier session.

**Go to rows.** The checkouts under "Not pushed" and "Changed this week" (of the shown context, at most 40) become
rows: title `<repo> · <branch>`, subtitle "3 not pushed · 2 changed", tag "Not pushed" or "Changed", `context`
when known. A row goes to the checkout's space (`focus: {space}`) or opens one (`run: [["space.new", …]]`). When
the last copy of Worktrees closes, it sets `goto.items.worktrees` to `null`.

## 4. Commands

`worktrees.<command>`, for `keys.json` and scripts. They reach a copy that is on screen.

| Command | Does |
|---|---|
| `refresh` | look for checkouts again and check all of them (the ↻ button) |
| `refresh:all` | the same, asking git for every checkout whatever the files say (Shift-↻) |
| `tick` | check the checkouts in use, as the panel does every five minutes |
| `show:needs`, `show:all` | the "Needs me" and "All" lists |
| `expand:<repo>` | open or close a row's branch card |
| `open:<repo>` | a row's click: its space, or a new one there |
| `pr:<repo>` | a click on the row's PR mark |
| `history:<repo>` | the card's "History ↗": the repo's history view, as a tab of its own |
| `older`, `more`, `family:<repo>` | fold or unfold "Older or untracked only", "Show n more", and one repo's worktrees |

`<repo>` is a checkout's path, its path below its root, or its name.

The history view has its own, so that a key reaches the right copy when both are on screen:

| Command | Does |
|---|---|
| `h-mode:branches`, `h-mode:branch`, `h-mode:all` | the three views |
| `h-filter:<text>` | the filter (empty: none) |
| `h-select:<row number, hash or branch>` | a click on that row |
| `h-unfold:<n>`, `h-unfold:all` | open the n-th fold from the top (0 is the first), or every one |
| `h-branch:<name>` | a click on that branch's chip |
| `h-more`, `h-refresh`, `h-esc` | "Load more", ↻, Esc |

**Opening the history view from another mod.** It is the same mod with props:

```js
run("tab.new", { name: "History · bookshelf", mod: "worktrees", props: {
  history: "/abs/path/to/the/checkout",   // required
  name: "bookshelf",                      // optional: the title
  branch: "feat/due-reminders",           // optional: what "This branch" means, drawn stronger
  slug: "octo/bookshelf",                 // optional: owner/name, for PR marks
  context: "blue",                        // optional: for opening spaces through the context hook
} });
```

## 5. Settings: `worktrees.config.json` (in the Herdr app home)

All keys optional; the values below are the defaults.

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

- `roots`: the folders searched for git checkouts, `depth` levels deep. Hidden folders and the names in `prune`
  are never entered. A root is never `/` or the home folder itself.
- `worktreeRoots`: folders whose checkouts are marked "agent worktree". The default is where Herdr's worktree mod
  puts them. `[]` turns it off.
- `max`: at most this many checkouts are listed (each one is a `git status` per pass).
- `weekDays`: how young tracked changes must be for "Changed this week".
- `goto`: `false` keeps the checkouts out of Go to.

## 6. Programs

- Required: `git` and `find`.
- Optional: `python3` for `probe.py` (standard library only), which tells from files which checkouts changed so
  that git is started only for those. Without it: one `git status` per checkout per check, and `stat` (BSD or GNU).
- The bars in the branch card need git 2.41 or newer (`for-each-ref %(ahead-behind:…)`). With an older git the
  card lists the branches without bars.
- "Open diff ↗" in the history view uses git's pager, `less`.
