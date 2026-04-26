import {existsSync} from "node:fs";
import {resolve} from "node:path";
import {run, runCapture, which} from "../lib/exec.ts";
import type {Step} from "../lib/types.ts";

export const gitInitStep: Step = {
  id: "03-git-init",
  title: "Initialize git repo",
  idempotent: true,
  async run({state, log}) {
    const target = resolve(state.inputs.targetDir!);
    if (existsSync(`${target}/.git`)) {
      log.info("Git repo already initialised; skipping init.");
    } else {
      run("git", ["init", "--initial-branch=main"], {cwd: target, capture: true});
      log.success("git init (branch main)");
    }

    // Initial commit. Pass --allow-empty=false so we error early if the
    // copy step somehow shipped nothing.
    const status = runCapture("git", ["status", "--porcelain"], {cwd: target});
    if (status.length > 0) {
      run("git", ["add", "-A"], {cwd: target, capture: true});
      const sourceSha = (() => {
        try {
          return runCapture("git", ["rev-parse", "HEAD"]);
        } catch {
          return "unknown";
        }
      })();
      const msg = `chore: bootstrap fork from patient template @ ${sourceSha.slice(0, 12)}`;
      run("git", ["commit", "-m", msg], {cwd: target, capture: true});
      log.success(`Initial commit on main (${msg}).`);
    } else {
      log.info("Working tree clean; no initial commit needed.");
    }

    // Optional: gh repo create + initial push.
    const slug = state.inputs.githubRepo;
    if (slug && which("gh")) {
      const exists = (() => {
        const r = run("gh", ["repo", "view", slug, "--json", "name"], {capture: true, allowFail: true});
        return r.exitCode === 0;
      })();
      if (!exists) {
        log.step(`Creating GitHub repo ${slug} (private)...`);
        run("gh", ["repo", "create", slug, "--private", "--source=.", "--remote=origin", "--push"], {
          cwd: target,
          capture: true,
        });
        state.artifacts.githubRepoCreated = slug;
        log.success(`GitHub repo created: https://github.com/${slug}`);
      } else {
        log.info(`GitHub repo ${slug} already exists; skipping create.`);
      }
    } else if (slug && !which("gh")) {
      log.warn(`gh CLI not installed — skipping GitHub repo create. Install with \`brew install gh\` and re-run, or push manually.`);
    }
  },
};
