// Demo only: what other mods would publish for the screenshots (RECIPE.md, "Demo"). It is a PR provider
// (worktrees.prs.demo, from demo/run/app/control/prs.json) and the context hook (goto.context: two invented
// setups, "Client" for ~/code/client and "Own" for the rest of ~/code; control/context.txt names the shown one,
// empty for both). Nothing here talks to the network.
import { View, div } from "gpui-kit";
import { shared, setShared, appHome, readTextFile, watchFolder } from "herdr";

const NAME = "worktrees"; // the mod this feeds

export default class WorktreesDemo extends View {
  init(_props, cx) {
    const p = shared(`${NAME}.providers`) ?? [];
    if (!p.includes("demo")) setShared(`${NAME}.providers`, [...p, "demo"]);
    const dir = `${appHome()}/control`;
    const read = async () => {
      const prs = JSON.parse((await readTextFile(`${dir}/prs.json`).catch(() => null)) ?? "[]");
      const doc = { at: Date.now() - 25 * 60 * 1000, prs };
      if (JSON.stringify(shared(`${NAME}.prs.demo`)?.prs) !== JSON.stringify(prs)) setShared(`${NAME}.prs.demo`, doc);
      const current = ((await readTextFile(`${dir}/context.txt`).catch(() => null)) ?? "").trim() || null;
      const hook = { // no `request`: nothing to switch in the demo, so the mod runs its commands itself
        current,
        folders: [["~/code/client", "client"], ["~/code", "own"]],
        labels: { client: "Client", own: "Own" }, colors: { client: "ansi4", own: "ansi5" },
      };
      if (JSON.stringify(shared("goto.context")) !== JSON.stringify(hook)) setShared("goto.context", hook);
    };
    cx.spawn(async () => { await read(); for (;;) { await watchFolder(dir); await read(); } });
  }

  render() {
    return div();
  }
}
