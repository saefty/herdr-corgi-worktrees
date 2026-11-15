# Changelog

## 0.1.0 (not released yet)

- First version: three lists over every git checkout (Not pushed, Changed this week, Older or untracked only),
  two-line rows, the branch card, agents' worktrees, PR marks from providers, contexts from the Go to hook, the
  count for a bar, rows in Go to.
- Checks start few processes: a helper (`probe.py`, optional python3) reads from files which checkouts changed,
  git runs only for those, the known state is kept across app starts, and the five-minute check covers only the
  checkouts in use.
- The history view: a repo's commits as a drawn tree (a lane per branch, folds for merged history, chips for
  branches, tags and pull requests, commit details), instead of `git log --graph` in a terminal.
- Open in your editor: a checkout, a worktree or a commit's file opens in VS Code or IntelliJ IDEA (Cursor, Zed,
  or one from the settings) from the row, the branch card and the history view, and with `worktrees.editor` from a
  key. The editor is suggested by the kind of project and can be picked per repo; the pick is shared with PR
  review. New optional requirement: one of these editors (see README, Requirements).
- Needs herdr-app 0.1.16. `herdr-app check` on the mod starts no process, watches nothing and stores nothing: the
  check draws the remembered list.
- Watches are given back: a repo that is no longer in use, a checkout that is gone and, while the panel is hidden,
  every repo without a space cancel their watch, so the mod no longer fills Herdr's 64 watched folders. A repo is
  read once when its watch starts.
- Herdr's own worktree folder (`worktrees.directory` in Herdr's `settings.json`, new in herdr-app 0.1.16) is
  searched and its checkouts are marked "agent worktree", next to `worktreeRoots`.
- Drag onto a terminal: a checkout's row gives its folder, a changed file in a commit's details gives that file
  in the checkout, if it is there.
- Fixes from the acceptance review: a pull request mark opens only an `https://` address; `{branch}` in a
  provider's `run` is treated as someone else's text; the helper gives no fingerprint for a split index or a
  checked-out submodule and is not fooled by a file dated in the future; a worktree whose repo is not under the
  roots is checked when it changes; a root whose name starts with a dot is searched; "All" draws 60 rows at a
  time; the rows in Go to stay when one of two copies of the panel closes; an editor menu's entry acts only in
  the copy that opened it; a dry run says that nothing was started; a short link says "Opening <Editor> …".
