# infra — authoritative OpenClaw config

Source of truth for the OpenClaw config running on the host VM at
`/root/.openclaw/openclaw.json`. Patterned after the `infra-registry`
profile model in the sister project `kittagents`, trimmed to one VM +
two agents — no HTTP service, just static files, a Bun build, and a
deploy script.

## Layout

```
infra/
├── openclaw.base.json         shared config (gateway, channels, plugins, memory, agents.defaults)
├── agents/
│   ├── main.json              admin agent — high thinking, 4096 tokens, fast mode
│   └── patient-support.json   patient agent — minimal thinking, 2048 tokens, fast mode
├── build.ts                   deep-merges base + agents/*.json → openclaw/openclaw.json
├── deploy.sh                  build + SCP + restart gateway on the VM
└── README.md
```

## Per-fork customization

Template placeholders — update for your deployment:

- `infra/deploy.sh` — `GCE_VM`, `GCE_ZONE`, `GCE_PROJECT` (marked with ★)
- `infra/agents/patient-support.json` — `{{PATIENT_AGENT_NAME}}` (substituted at fork time)
- `infra/openclaw.base.json` — `channels.web-chat.webhookSecret` and
  `gateway.auth.token` should be regenerated per deployment; `channels.whatsapp.allowFrom`
  gets replaced with your admin number.

## Editing an agent

1. Update `infra/agents/<agent>.json`.
2. `bun run infra/build.ts` — re-renders `openclaw/openclaw.json`.
3. `./infra/deploy.sh` — pushes to the VM and restarts the gateway. The
   deploy script runs `openclaw config validate` on the VM before
   committing, and keeps a `.bak` of the previous config.

## Why not edit `openclaw/openclaw.json` directly?

That file is the **rendered** output of this pipeline and should not be
hand-edited — the build overwrites it. If you modify it directly and don't
back-port the change into `infra/`, the next build silently reverts you.

## Merge rules

`build.ts` does a straightforward deep merge: objects recurse, scalars
and arrays are replaced by the right-hand side. `agents.list` is built
from the set of files in `agents/` — the `main` agent is always first
(default), followed by the others in filename order.

## Guardrails that keep the web-chat gateway happy

The sister project (`kittagents`) runs multiple agents with `think: high`
on a 2 vCPU / 2 GB VM and stays stable because each turn is bounded. We
mirror those bounds here:

| knob                         | where                 | why                                                    |
|------------------------------|-----------------------|--------------------------------------------------------|
| `fastModeDefault: true`      | per-agent             | streams the fast path instead of the slow/thorough one |
| `params.maxTokens`           | per-agent / defaults  | caps reply length so long turns finish before 120 s    |
| `params.textVerbosity: low`  | defaults              | the model writes terser output                         |
| `params.think`               | per-agent             | `high` on admin, `minimal` on patient-support          |

Without these, `think: high` alone can blow past the 120-second web-chat
dispatch cap and the UI marks the agent "down" even though a correct
reply eventually arrives.
