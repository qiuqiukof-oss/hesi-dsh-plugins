# Hesi DSH Plugins

> **By Hesi · Same-origin implementation** — Two original workflows from
> [Hesi](https://github.com/qiuqiukof-oss/Hesi) (a browser-based terminal + AI agent hub),
> packaged as plugins for [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness):
> **Roundtable discussion** and **One-click execution plan**.

Both plugins work as **service + tool** (they do **not** replace DSH's `ctx.agentLoop`).
They reuse the native multi-agent `ctx.agents.create` and the built-in `ctx.planMode`.
All DSH runtime calls are isolated in a thin adapter layer (`src/seats.js` / `src/plan-adapter.js`),
so upstream API changes only touch the adapter.

| Plugin | Package | Capabilities |
|---|---|---|
| Roundtable | `@hesi/dsh-roundtable` | `ctx.hesiRoundtable` service + `roundtable` tool |
| Execution plan | `@hesi/dsh-plan` | `ctx.hesiPlan` service + `run_plan` tool |

---

## Plugins vs Hesi Enterprise

| Capability | This repo (open source) | Hesi Enterprise |
|---|---|---|
| Roundtable (multi-seat / 5 phases / moderator verdict) | ✅ Full | ✅ Same origin + deeper integration |
| Execution plan (generate / gate / execute / machine-verify / rollback / blind-review) | ✅ Full | ✅ Same origin + more guardrails |
| Checkpoint soft-breakpoints (roundtable-derived acceptance, plugins interlock) | ✅ | ✅ |
| Expert marketplace (447 domain personas) | ❌ Not included | ✅ |
| Enterprise connectors (60+ third-party services) | ❌ Not included | ✅ |
| Knowledge base / files / discussions / multi-user collaboration | ❌ Not included | ✅ |
| RBAC / audit / approval flows / enterprise deployment | ❌ Not included | ✅ |
| Browser terminal + AI agent hub | ❌ Not included | ✅ |

> Need the full workbench and ecosystem → [Hesi](https://github.com/qiuqiukof-oss/Hesi) (Enterprise).

---

## Quick start (DSH profile)

Prereqs: DSH 0.1.0-rc.5+ (monorepo build or CLI), any OpenAI-compatible LLM
(DeepSeek official / AGNES / LM Studio, etc.).

### 1) Add the plugins to a profile

```jsonc
// $DSH_HOME/profiles/<name>/package.json
{
  "dependencies": {
    "@hesi/dsh-roundtable": "file:./hesi-dsh-roundtable",
    "@hesi/dsh-plan": "file:./hesi-dsh-plan"
  },
  "dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-headless"] } }
}
```

### 2) Compose (new entries in the patch layer MUST use `- insert:`)

Merge `examples/hesi-profile.patch.yml` into `$DSH_HOME/profiles/<name>/cordis.patch.yml`:

- use `- insert:` to add the `hesi-roundtable` / `hesi-plan` entries (DSH patches can only override existing ids);
- `llm-pi-ai` is mounted dormant — activate it with a hand-written `providers.<name>` route;
- point `agent-default-model` at your provider/model.

### 3) Run

```sh
DSH_HOME=$DSH_HOME dsh --profile <name> "用 roundtable 工具组织一场 3 人圆桌讨论：是否应该为项目引入自动化测试？"
```

```sh
DSH_HOME=$DSH_HOME dsh --profile <name> "用 run_plan 工具制定并执行一个计划：列出当前目录下的文件和目录"
```

(Verified against local LM Studio and AGNES cloud `agnes-2.5-flash`.)

---

## Plugin details

### @hesi/dsh-roundtable — Roundtable workflow

Multi-agent round-table discussion → synthesis → verdict (Hesi's original core):

- **5-phase state machine**: discuss → propose → implement → review → report (`src/phases.js`, pure);
- moderator role advances phases with `[VERDICT:...]` and phase summaries (`src/moderator.js`, pure);
- seats are spawned via native `ctx.agents.create` (no agent-loop replacement), runtime calls isolated in `src/seats.js`;
- exports `ctx.hesiRoundtable.deriveVerify(question, rounds)` for the plan plugin's checkpoint soft-breakpoints.

### @hesi/dsh-plan — One-click execution plan

An Hesi-specific **autonomous execution layer** on top of DSH's built-in `plan-mode`:

- generate (one-shot planner seat / preset JSON) → gate (must contain a machine-verifiable acceptance) → execute stepwise → machine-verify → snapshot rollback on critical failure → blind-review;
- **checkpoint soft-breakpoints**: steps without machine-verifiable acceptance call the roundtable's `deriveVerify` (the two plugins interlock);
- **production guardrails** (built into `plan-adapter.js`): forbidden command list (`rm -rf <root>`, `git push --force`, `format`, …) + scope confinement (`workdir` pinned to the workspace; drive-root switches / out-of-scope absolute paths blocked) + fail-closed approval (`ctx.userQuestions`, deny when no channel);
- **hard snapshot** via `tar` (excludes `node_modules` / `.git`, stored under `scope/.hesi-snapshots/`), no `git stash` dependency;
- Windows uses `tool-pwsh` automatically (DSH disables `tool-bash` on win32).

---

## Security & credentials

- **Credentials never hit disk**: LLM keys go through environment variables (`apiKeyEnv`); this repo and the plugins contain no secrets;
- **Command guardrails**: forbidden list + scope confinement built in; `requireApproval: true` enables stepwise human approval (needs a UI user-questions provider);
- DSH tools additionally provide a file sandbox + escalation approval (`sandbox_permissions`) — two layers on top.

---

## Verification

`verify/` proves the adapter-layer ports with a mock ctx executing the real adapter code.

```sh
cd verify
node --import ./loader.mjs run-dsh-mock.mjs     # runtime check (offline, zero deps)
npx -y typescript@latest tsc --noEmit -p tsconfig.verify.json   # type-contract check (optional)
```

---

## License

MIT © 2026 Hesi (qiuqiukof). See [LICENSE](./LICENSE).

---

## Related projects

| Project | Description |
|---|---|
| [Hesi-Q](https://github.com/qiuqiukof-oss/Hesi-Q) | Hesi open-source personal edition (MIT): browser terminal + AI agent hub — the same-origin parent of these plugins |
| [Hesi Enterprise](https://github.com/qiuqiukof-oss/Hesi) | Full workbench: expert marketplace / connectors / knowledge base / RBAC·audit / enterprise deployment |
