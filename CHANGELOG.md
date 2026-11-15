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
