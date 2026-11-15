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
