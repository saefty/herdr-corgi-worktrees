#!/bin/sh
# Builds the demo in demo/run (recreated on every run, ignored by git):
#   run/user  a stand-in home. ~/code holds invented repos with branches, a stash, unpushed commits, old and new
#             changes, and one with a longer history (fixtures/history-repo.sh); ~/.herdr/worktrees holds agents'
#             worktrees of three of them. Each repo pushes to a bare repo
#             under run/remotes once, then its origin URL is rewritten to read like GitHub's: nothing here ever
#             talks to the network. herdr-core's config points this home at its own core, so the demo never
#             shares terminals with yours (socket /tmp/herdr-worktrees-demo/core.sock: socket paths must be short).
#   run/app   a Herdr home with the mod, the worktrees-demo provider mod (PR marks, two contexts) and settings.
# Then demo/record.sh opens a second Herdr window on it and takes the screenshots.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
root=$(dirname "$here")
run="$here/run" user="$here/run/user" app="$here/run/app" remotes="$here/run/remotes"
code="$user/code" wt="$user/.herdr/worktrees"
core=$(command -v herdr-core || command -v hc)
rm -rf "$run"
mkdir -p "$user/.config/herdr-core" "$app/mods" "$app/control" "$code" "$wt" "$remotes" /tmp/herdr-worktrees-demo

printf 'socket = "/tmp/herdr-worktrees-demo/core.sock"\nshell = ["/bin/zsh"]\n' > "$user/.config/herdr-core/config.toml"
printf "PROMPT='%%F{cyan}%%~%%f %%# '\n" > "$user/.zshrc"

# git without your settings (no signing, no hooks, no templates), as an invented author
export HOME="$user" GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null
export GIT_AUTHOR_NAME=Demo GIT_AUTHOR_EMAIL=noreply@example.com GIT_COMMITTER_NAME=Demo GIT_COMMITTER_EMAIL=noreply@example.com

ago() { date -v-"$1" +%Y%m%d%H%M 2>/dev/null || date -d "-$(echo "$1" | sed 's/d$/ days/;s/w$/ weeks/')" +%Y%m%d%H%M; }  # ago 3d: a touch -t stamp
commit() { echo "$1" >> "${2:-notes.txt}"; git add -A; git commit -qm "$1"; }
new() { # new <dir> [owner/repo]: one commit on main; with a slug, pushed once to a local bare repo
  mkdir -p "$1"; cd "$1"; git init -q -b main .; echo "# ${1##*/}" > README.md; commit "chore: start"
  if [ -n "${2:-}" ]; then
    git init -q --bare -b main "$remotes/${2##*/}.git"; git remote add origin "$remotes/${2##*/}.git"; git push -qu origin main
  fi
}
github() { git remote set-url origin "https://github.com/$1.git"; }
old() { touch -t "$(ago "$1")" .git/logs/HEAD .git/HEAD; }  # the last commit, as far as file times say

# orbit-api: unpushed commits, tracked changes, a stack of two PRs, a merged branch, a gone upstream, worktrees
new "$code/orbit-api" acme/orbit-api
git checkout -qb fix/retry-old; commit "fix: retry with backoff"; git push -qu origin fix/retry-old; merged=$(git rev-parse HEAD)
git checkout -q main; git checkout -qb chore/deps; commit "chore: bump deps"; git push -qu origin chore/deps; git push -q origin --delete chore/deps; git fetch -q --prune
git checkout -q main; commit "feat: health endpoint"; commit "docs: health endpoint"; git push -q origin main
git checkout -qb feat/login-flow main~2; commit "feat: login form"; git push -qu origin feat/login-flow; commit "feat: validate input"; commit "feat: error states"; commit "feat: wire submit"
git checkout -qb feat/login-tokens; commit "feat: token store"; git push -qu origin feat/login-tokens
git branch -q spike/cache main~1
git checkout -q feat/login-flow; echo "wip" >> notes.txt; echo "more" >> README.md
for n in fix-timeouts cache-warmup flaky-test metrics-labels; do
  git worktree add -q "$wt/orbit-api/agent-$n" -b "agent/$n" main
  (cd "$wt/orbit-api/agent-$n" && commit "feat: $n")
done
echo "tmp" >> "$wt/orbit-api/agent-fix-timeouts/README.md"
git worktree add -q "$code/orbit-api-spike" spike/cache
github acme/orbit-api

# a long name, a branch that was never pushed, a stash
new "$code/customer-notification-event-consumer" acme/event-consumer
git checkout -qb feat/first-draft; for i in 1 2 3 4 5; do commit "feat: draft $i"; done
echo "stashed" >> notes.txt; git stash -q; github acme/event-consumer; old 2d

# tracked and untracked changes from today, an open PR
new "$code/billing-worker" acme/billing-worker
git checkout -qb feat/invoices; commit "feat: invoice model"; git push -qu origin feat/invoices
for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18; do echo "x" > "src$i.txt"; done; git add -A; git commit -qm "feat: sources"; git push -q
for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18; do echo "changed" >> "src$i.txt"; done; echo a > new1.txt; echo b > new2.txt; echo c > new3.txt
github acme/billing-worker

# changed three days ago; changed five weeks ago; untracked files only; behind only; no remote; clean
new "$code/docs-site" acme/docs-site
echo "edit" >> README.md; touch -t "$(ago 3d)" README.md; github acme/docs-site; old 20d
new "$code/legacy-importer" acme/legacy-importer
echo "old edit" >> README.md; touch -t "$(ago 5w)" README.md .git/index; github acme/legacy-importer; old 9w
new "$code/data-dump" acme/data-dump
i=0; while [ $i -lt 120 ]; do i=$((i + 1)); echo x > "export-$i.csv"; done; github acme/data-dump; old 12d
new "$code/infra-modules" acme/infra-modules
for i in 1 2 3 4 5 6 7 8 9 10 11 12; do commit "feat: upstream $i"; done; git push -q origin main; git reset -q --hard HEAD~12; github acme/infra-modules; old 30d
new "$code/scratch-notes"; old 40d
new "$code/clean-lib" acme/clean-lib; github acme/clean-lib; old 3w

# the same name in another folder
new "$code/tools/orbit-api" acme/orbit-tools
echo "edit" >> README.md; touch -t "$(ago 1d)" README.md; github acme/orbit-tools; old 6d

# a second setup under ~/code/client
new "$code/client/garden-planner" globex/garden-planner
git checkout -qb feat/beds; commit "feat: bed layout"; git push -qu origin feat/beds; commit "feat: paths"
git worktree add -q "$wt/garden-planner/agent-seed-data" -b agent/seed-data main
github globex/garden-planner
echo "seeds" >> "$wt/garden-planner/agent-seed-data/README.md"
new "$code/client/recipe-box" globex/recipe-box
echo "edit" >> README.md; touch -t "$(ago 2d)" README.md; github globex/recipe-box; old 10d
new "$code/client/photo-sorter" globex/photo-sorter
echo "later" >> README.md; git stash -q; github globex/photo-sorter; old 8w

# a repo with a longer history, for the history view: merged side branches, tags, long branch names, a stack
sh "$here/fixtures/history-repo.sh" "$code/atlas-platform" "$remotes" "$wt"

# PR data as a provider would publish it (invented): worktrees-demo reads this file
cat > "$app/control/prs.json" <<JSON
[ { "repo": "acme/orbit-api", "branch": "feat/login-flow", "number": 412, "state": "draft", "base": "main", "url": "https://github.com/acme/orbit-api/pull/412" },
  { "repo": "acme/orbit-api", "branch": "feat/login-tokens", "number": 413, "state": "open", "base": "feat/login-flow", "url": "https://github.com/acme/orbit-api/pull/413" },
  { "repo": "acme/orbit-api", "branch": "fix/retry-old", "number": 398, "state": "merged", "base": "main", "headSha": "$merged", "url": "https://github.com/acme/orbit-api/pull/398" },
  { "repo": "acme/billing-worker", "branch": "feat/invoices", "number": 7, "state": "open", "base": "main", "url": "https://github.com/acme/billing-worker/pull/7" },
  { "repo": "acme/atlas-platform", "branch": "feature/checkout-redesign-with-saved-payment-methods-and-address-book", "number": 88, "state": "open", "base": "main", "url": "https://github.com/acme/atlas-platform/pull/88" },
  { "repo": "acme/atlas-platform", "branch": "feature/checkout-redesign-express-lane-for-returning-customers", "number": 89, "state": "draft", "base": "feature/checkout-redesign-with-saved-payment-methods-and-address-book", "url": "https://github.com/acme/atlas-platform/pull/89" },
  { "repo": "acme/atlas-platform", "branch": "bugfix/PLAT-2041-retry-webhook-delivery-when-the-partner-endpoint-times-out", "number": 86, "state": "open", "base": "main", "url": "https://github.com/acme/atlas-platform/pull/86" },
  { "repo": "globex/garden-planner", "branch": "feat/beds", "number": 3, "state": "open", "base": "main", "url": "https://github.com/globex/garden-planner/pull/3" } ]
JSON
: > "$app/control/context.txt"

cp -R "$root/mods/worktrees" "$here/fixtures/worktrees-demo" "$app/mods/"
printf '{ "roots": ["~/code"], "depth": 4 }\n' > "$app/worktrees.config.json"
printf '{ "appearance": "dark", "telemetry": false, "sounds": { "enabled": false }, "core": "%s" }\n' "$core" > "$app/settings.json"
# Where the window opens: DEMO_BOUNDS="x y width height" (put it where your mouse is not, so no row shows a hover
# in the shots; a second screen works well). Skip the welcome tour and the "Updated" pill.
set -- ${DEMO_BOUNDS:-1800 60 1280 1040}
printf '{ "state": "windowed", "bounds": [%s.0, %s.0, %s.0, %s.0] }\n' "$1" "$2" "$3" "$4" > "$app/window.json"
printf '{ "frame.welcomed": "skipped" }\n' > "$app/shared.json"
printf '{ "last_run": "%s", "presented": [] }\n' "$(herdr-app --version | grep -o '[0-9][0-9.]*' | head -1)" > "$app/update-notes.json"
echo "demo ready: $run"
