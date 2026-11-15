#!/bin/sh
# An invented repo with enough history for the history view: a main line with tags and merged side branches,
# and unmerged branches with very long names (a stack of two, one synced with its remote, one that merged main
# into itself, one forked from old history, one in an agent's worktree).
#   history-repo.sh <repo folder> <folder for the bare remote> <folder for the worktree>
# Nothing talks to the network: the remote is a bare repo next door, and origin's URL is rewritten afterwards.
set -eu
repo=$1 remotes=$2 wt=$3
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null GIT_COMMITTER_EMAIL=noreply@example.com GIT_AUTHOR_EMAIL=noreply@example.com
now=$(date +%s)
n=0
# commit <days ago> <author> <subject>: a file of its own per commit, so merges never conflict
commit() {
  n=$((n + 1)); when="$((now - $1 * 86400 - (200 - n) * 60)) +0000"
  echo "$3" > "change-$n.txt"; git add -A
  GIT_AUTHOR_NAME="$2" GIT_COMMITTER_NAME="$2" GIT_AUTHOR_DATE="$when" GIT_COMMITTER_DATE="$when" git commit -qm "$3"
}
# side <days ago> <author> <branch> <subject>...: a branch off main with those commits, merged back with a merge commit
side() {
  d=$1 who=$2 b=$3; shift 3
  git checkout -qb "$b"
  for s in "$@"; do commit "$d" "$who" "$s"; done
  git checkout -q main
  n=$((n + 1)); when="$((now - d * 86400 - (200 - n) * 60)) +0000"
  GIT_AUTHOR_NAME="$who" GIT_COMMITTER_NAME="$who" GIT_AUTHOR_DATE="$when" GIT_COMMITTER_DATE="$when" git merge -q --no-ff -m "Merge branch '$b'" "$b"
  git branch -qD "$b"
}
ADA="Ada Brandt" JON="Jonas Meyer" PRI="Priya Nair"

mkdir -p "$repo"; cd "$repo"; git init -q -b main .
commit 70 "$ADA" "chore: start the platform repo"
commit 69 "$ADA" "feat(api): health and version endpoints"
commit 66 "$JON" "feat(catalog): product list with paging"
side 64 "$PRI" feature/catalog-filters "feat(catalog): filter by category" "test(catalog): filter combinations"
commit 60 "$JON" "fix(catalog): stable sort for equal prices"
commit 58 "$ADA" "docs: how to run the stack locally"
git tag v1.0
git branch -q spike/try-streaming-export
commit 55 "$PRI" "feat(cart): add and remove items"
commit 52 "$PRI" "feat(cart): totals with tax"
side 50 "$JON" feature/cart-persistence "feat(cart): keep the cart across sessions" "fix(cart): merge the guest cart on login" "test(cart): persistence"
commit 47 "$ADA" "refactor(api): one error shape for every route"
commit 44 "$JON" "perf(catalog): cache the category tree"
commit 41 "$ADA" "fix(api): 404 instead of 500 for unknown products"
commit 38 "$PRI" "feat(checkout): address form"
side 36 "$ADA" feature/checkout-shipping-options "feat(checkout): shipping options" "feat(checkout): delivery estimate"
commit 33 "$JON" "chore: bump dependencies"
git tag v1.1
commit 30 "$PRI" "feat(orders): order history page"
commit 27 "$JON" "fix(orders): show cancelled orders"
commit 24 "$ADA" "docs: architecture overview"
side 21 "$PRI" feature/order-export "feat(orders): export as CSV" "fix(orders): escape semicolons in the export"
commit 18 "$JON" "test: end-to-end checkout"
commit 15 "$ADA" "feat(api): rate limits per client"
commit 12 "$PRI" "fix(checkout): keep the address when payment fails"
git init -q --bare -b main "$remotes/atlas-platform.git"; git remote add origin "$remotes/atlas-platform.git"; git push -q -u origin main; git push -q origin --tags

# a spike forked from old history, never pushed
git checkout -q spike/try-streaming-export; commit 9 "$JON" "feat(export): stream large exports instead of buffering"
# unmerged, synced with its remote
git checkout -qb bugfix/PLAT-2041-retry-webhook-delivery-when-the-partner-endpoint-times-out main~2
commit 8 "$PRI" "fix(webhooks): retry with backoff when the partner times out"
commit 7 "$PRI" "test(webhooks): timeouts and retries"
git push -q -u origin HEAD
# unmerged, merged main into itself once
git checkout -qb feature/search-facets-for-brand-color-and-size main~4
commit 10 "$JON" "feat(search): facets for brand"
commit 9 "$JON" "feat(search): facets for color and size"
n=$((n + 1)); when="$((now - 6 * 86400)) +0000"
GIT_AUTHOR_NAME="$JON" GIT_COMMITTER_NAME="$JON" GIT_AUTHOR_DATE="$when" GIT_COMMITTER_DATE="$when" git merge -q --no-ff -m "Merge branch 'main' into feature/search-facets-for-brand-color-and-size" main
commit 5 "$JON" "fix(search): facet counts after the merge"
# two more commits on main after the branches forked
git checkout -q main
commit 6 "$ADA" "feat(api): request ids in every log line"
commit 4 "$ADA" "fix(api): rate limit header names"
git push -q origin main
# the stack: a long branch with two unpushed commits, and one more branch on top of it
git checkout -qb feature/checkout-redesign-with-saved-payment-methods-and-address-book main~1
commit 5 "$PRI" "feat(checkout): saved payment methods"
commit 4 "$PRI" "feat(checkout): address book"
commit 3 "$PRI" "refactor(checkout): one form state for all steps"
git push -q -u origin HEAD
commit 2 "$PRI" "fix(checkout): default address after deleting one"
commit 1 "$PRI" "test(checkout): saved methods and address book"
git checkout -qb feature/checkout-redesign-express-lane-for-returning-customers
commit 1 "$ADA" "feat(checkout): express lane for returning customers"
commit 0 "$ADA" "feat(checkout): one-tap confirm"
# an agent's worktree with a branch that was never pushed
git worktree add -q "$wt/atlas-platform/agent-upgrade-toolchain" -b chore/upgrade-build-toolchain-and-drop-legacy-node-16-support main
( cd "$wt/atlas-platform/agent-upgrade-toolchain"
  commit 2 "$JON" "chore(build): move to the new bundler"
  commit 1 "$JON" "chore(build): drop legacy node 16 support"
  commit 0 "$JON" "ci: cache the bundler output" )
git checkout -q feature/checkout-redesign-with-saved-payment-methods-and-address-book
git remote set-url origin "https://github.com/acme/atlas-platform.git"
