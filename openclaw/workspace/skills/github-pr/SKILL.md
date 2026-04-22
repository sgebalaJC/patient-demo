---
name: github-pr
description: Open a pull request on the practice's GitHub repo to propose changes to openclaw configuration (SOUL, IDENTITY, skills, etc.). Everything lives under `openclaw/` in the repo; anything outside that path is rejected.
user-invocable: true
---

# GitHub PR

Whenever you change something important — your **SOUL**, **IDENTITY**,
a **skill**, a **channel** wiring in `openclaw.json`, or any other
file tracked under `openclaw/` in the repo — you open a pull request
so the humans can review before it ships. You don't merge; you open
the PR and describe what changed and why.

## When to use

- You refined one of your own skills (added a rule, clarified
  phrasing, added an example).
- You rewrote part of SOUL/IDENTITY/USER/AGENTS that a human asked
  you to persist.
- You touched a channel or gateway setting in `openclaw.json` that
  the humans care about (e.g. Slack behavior, new channel account).
- You added or removed a skill directory under
  `openclaw/workspace/skills/`.

**Do NOT** use this skill for patient data, EHR records, faxes, or
anything outside `openclaw/`. The script refuses those paths on
purpose.

## How it works

1. A persistent git working copy lives at `{{AGENT_REPO_WORKTREE}}`
   on the VM (per-fork — rewritten during setup). First use clones
   `{{GITHUB_REPO}}` automatically.
2. You edit the file(s) **inside that working copy** using bash
   (`sed`, `cat >`, etc.) — the same way a human would.
3. Run `agent-pr <branch> <title> <body>`. The wrapper stashes,
   syncs `main`, creates the branch, verifies every changed file is
   under `openclaw/`, commits, pushes, and opens the PR.

The PAT comes from the `GITHUB_TOKEN` env var injected by systemd —
you don't manage it.

## Invocation

```bash
cd {{AGENT_REPO_WORKTREE}}

# Example: tighten the attach-to-drchrono skill
cat > openclaw/workspace/skills/attach-to-drchrono/SKILL.md <<'EOF'
---
name: attach-to-drchrono
description: Upload a PDF to a DrChrono patient chart.
user-invocable: true
---
# ... new content ...
EOF

agent-pr agent/attach-skill-tighten \
  "Tighten attach-to-drchrono confirmation step" \
  "Always confirm the DrChrono chart ID with the operator before upload, per the Apr 20 request."
```

The script prints the PR URL on success. Paste that URL into your
reply so the operator can review.

## Branch naming

Always prefix your branch with `agent/` so humans can filter them
out at a glance:

- `agent/<short-what>-<YYYYMMDD>` is a safe pattern
- Good: `agent/slack-quiet-hours-20260420`
- Avoid: `feat/slack-tweak` (looks like a human branch)

## Safety

- **Scope**: only files under `openclaw/` are accepted. Attempting
  to stage anything else exits non-zero without pushing.
- **Never `--force` push**: the script doesn't allow it.
- **Never commit credentials**: files under `openclaw/credentials/`
  are listed as sensitive; do not recreate them in the working copy.
- If you're unsure whether a change warrants a PR, **ask the
  operator first**.

## Failure modes

- `GITHUB_TOKEN is not set` → the VM's systemd env file doesn't
  have the PAT. Tell the operator; don't try to work around it.
- `No changes staged or working-tree` → you invoked the script
  before editing. Edit first, then re-run.
- `files outside allowed scope` → you edited something that isn't
  under `openclaw/`. Revert those edits (`git checkout <file>`) and
  try again with only the in-scope changes.
- `gh: authentication failed` → the PAT is invalid or missing the
  `repo` scope. Report to the operator.
