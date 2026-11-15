#!/bin/sh
# Opens a second Herdr window on the demo (run demo/setup.sh first), adds the panel to a copy of the main layout,
# takes the screenshots into docs/screenshots and preview.png, then closes the window and stops the demo core.
# Your own window, home and terminals are not touched: HOME, the Herdr home and the core are the demo's.
# Clicks are simulated with the mod's commands (worktrees.expand:<repo>, …); needs ffmpeg for the crops.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
root=$(dirname "$here")
run="$here/run" user="$here/run/user" out="$root/docs/screenshots" frames="$here/run/frames"
export HERDR_APP_HOME="$run/app"
mkdir -p "$out" "$frames"

HOME="$user" SHELL=/bin/zsh DO_NOT_TRACK=1 HERDR_TELEMETRY=0 \
  /Applications/Herdr.app/Contents/MacOS/Herdr > "$run/herdr.log" 2>&1 &
until herdr-app status > /dev/null 2>&1; do sleep 1; done
sleep 2
do_() { herdr-app do "$@" > /dev/null; }
# A copy of the main layout with the panel as a third child of the right column's stack, shown at 380 px, and a
# 0 px block for the provider mod to run in.
do_ layout.clone --name main --as demo
node -e '
const fs = require("fs"), p = process.argv[1], l = JSON.parse(fs.readFileSync(p));
const find = (n, id) => n.id === id ? n : (n.children ?? []).map((c) => find(c, id)).find(Boolean);
const panel = find(l, "panel"), body = find(l, "panel-body");
body.children.push({ id: "worktrees", type: "block", content: { mod: "worktrees" } });
body.active = "worktrees"; panel.hidden = false; panel.size = { px: 380 };
find(l, "sidebar").children.splice(1, 0, { id: "worktrees-demo", type: "block", size: { px: 0 }, content: { mod: "worktrees-demo" } });
fs.writeFileSync(p, JSON.stringify(l, null, 2));' "$run/app/layouts/demo.json"
do_ layout.switch --name demo
herdr-app do space.new "{\"name\":\"orbit-api\",\"folder\":\"$user/code/orbit-api\",\"tab\":\"shell\",\"argv\":[\"/bin/zsh\"]}" > /dev/null
panel() { do_ layout.select --stack panel-body --child worktrees; do_ layout.show --id panel; do_ layout.resize --id panel --px "$1"; }
panel 380
# A fresh home greets with the welcome or what's-new screen: close whatever the app opened by itself.
overlays() { herdr-app status | node -pe 'JSON.parse(require("fs").readFileSync(0)).overlays.length'; }
for _ in 1 2 3; do [ "$(overlays)" = 0 ] || do_ overlay.close; done
# The first pass over the demo repos: wait until the mod has stored it.
store="$run/app/data/worktrees/store.json"
i=0; until [ -f "$store" ] && grep -q '"pass"' "$store"; do i=$((i + 1)); [ $i -lt 90 ] || { echo "no pass after 90 s" >&2; break; }; sleep 1; done
sleep 2

# A covered window draws only when resized, so every shot nudges it (maximize and back) first. Your mouse over the
# demo window can leave a hover highlight on a row: look at the shots and run again if one has it.
snap() { do_ window.maximize; sleep 0.8; do_ window.maximize; sleep 0.8; herdr-app shot "$frames/$1.png" > /dev/null; }
crop() { ffmpeg -loglevel error -y -i "$frames/$1.png" -vf "crop=$3" "$2"; } # frame, out, w:h:x:y (window pixels at 2x)
cmd() { do_ "worktrees.$1"; sleep "${2:-1}"; }
size() { ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0:s=x "$frames/$1.png"; }

snap needs
w=$(size needs | cut -dx -f1); h=$(size needs | cut -dx -f2)
col="776:$((h - 84 - 56)):$((w - 776)):84"   # the 380 px column and its gap, below the tab bar and above the status bar
crop needs "$out/needs-me.png" "$col"
cmd expand:orbit-api 8; snap card   # the card reads its branches: give git time on a busy machine
crop card "$out/branch-card.png" "$col"
crop card "$root/preview.png" "$((w - 560)):$((h - 56)):560:0"
cmd expand:orbit-api; cmd older; snap older; crop older "$out/older.png" "$col"
cmd older; cmd show:all; snap all; crop all "$out/all.png" "$col"
cmd show:needs
printf 'client' > "$run/app/control/context.txt"; sleep 2; snap context; crop context "$out/context.png" "$col"
: > "$run/app/control/context.txt"; sleep 2
panel 290; sleep 1; snap narrow; crop narrow "$out/narrow.png" "596:$((h - 84 - 56)):$((w - 596)):84"
panel 380
cmd history:orbit-api 3; cmd expand:orbit-api 8; snap history; cp "$frames/history.png" "$out/history.png"
cmd open:docs-site 3   # a row's click: a second space, on that checkout
herdr-app ls | node -pe '"spaces: " + JSON.parse(require("fs").readFileSync(0)).spaces.map((s) => s.name).join(", ")'

[ -z "${KEEP:-}" ] || exit 0 # KEEP=1: leave the demo window open to try things
do_ app.quit || true
HOME="$user" hc server stop > /dev/null || true
ls -l "$root/preview.png" "$out"
