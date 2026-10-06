# Agent and extension security notes

Planora is built by coding agents (Claude Code and Codex) through the role pipeline in `docs/PROCESS.md`, and the running app calls an LLM for task parsing and chat. This note reviews both surfaces. It covers the repo as of commit `786ec23`.

## 1. Development agents (Claude Code / Codex)

### What is configured

| Surface | File | Notes |
| --- | --- | --- |
| Project instructions | `AGENTS.md`, `CLAUDE.md` | Binding rules: bun/uv only, no hand-editing generated files, no third-party telemetry, commits attributed to the owner only. |
| Role subagents | `.agents/*.md` (Claude, via the `.claude/agents` symlink), `.codex/agents/*.toml` | Six roles. The tester is kept independent of the engineers and the PM. |
| Slash commands | `.claude/commands/{next,issue,verify,ship}.md` | `/ship` (merge and push) is orchestrator-only. |
| Claude permissions | `.claude/settings.json` | Has `allow`, `ask` and `deny` lists. |
| Codex command policy | `.codex/rules/planora.rules` | `forbidden` for npm/npx/pip, `gh pr`, `git stash`, `git reset --hard` and force-push; `prompt` for `git push`. |
| MCP servers | none | No third-party tool servers are loaded, which keeps the attack surface small. |
| Hooks | none | No deterministic pre- or post-tool guard. |

### Controls that work

- **Destructive git operations are blocked by machine-enforced rules, not just prose.** This applies in both harnesses: `git push --force`, `git reset --hard` and `git stash` are denied, and `git push` and `git merge` need approval.
- **Package managers are pinned to bun and uv** (`npm install`, `npx` and `pip install` are denied). This keeps every dependency resolving through the reviewed lockfiles (binding rules 7–8).
- **Generated files can't be edited by agents** (`routeTree.gen.ts`, `schema.gen.ts`). CI also re-generates and diffs them.
- **Separation of duties.** The engineer, the independent tester and the PM accept work in turn. The orchestrator commits, but it does not write feature code on the full lane.
- **CI is the final gate.** `permissions: contents: read` and every check run on every push.

### Risks and recommendations

| ID | Risk | Severity | Recommendation |
| --- | --- | --- | --- |
| A1 | **Untrusted issue text is used as agent instructions.** `/issue N` and `/next` read GitHub issue bodies with `gh issue view`. The repo is public, so anyone can open an issue, and a crafted body could try to steer an agent that has commit rights (prompt injection). | Medium | Only pick issues that the owner has labeled (e.g. a `ready` label only the owner applies). Treat issue bodies as data in the role prompts. Restrict who can create issues, or triage new issues manually. |
| A2 | **`Bash(bun install*)` and `Bash(uv add*)` are auto-allowed.** These patterns also match `bun install <any-package>`, so an agent can add a dependency without a prompt. That is a supply-chain risk. | Medium | Narrow the rule to `Bash(bun install --frozen-lockfile*)`. Move `uv add*` to `ask`. |
| A3 | **`Read` is allowed for every path**, including `apps/api/.env`, which holds the real `LLM_API_KEY`, `APP_PASSWORD` and `SESSION_SECRET`. | Medium | Add `Read(**/.env)`, `Read(**/runtime.env)` and `Read(deploy/*.env)` to `deny`. |
| A4 | **`gh issue create/edit/comment` is auto-allowed.** An agent can post to a public tracker without approval, which could leak logs or paths. | Low | Move these to `ask`, or keep them and rely on the role rule "never put real credentials in issue comments" (`docs/ops/deploy.md`). |
| A5 | **No hook backs up the prose rules.** For example, nothing deterministically stops an agent from staging a `.env` file or adding a `Co-Authored-By` trailer. `.gitignore` covers `.env`, but `git add -A` is used in `/ship`. | Low | Add a `PreToolUse` hook for `Bash(git commit*)` that runs `detect-secrets-hook` (or `gitleaks protect --staged`) on the staged diff. |
| A6 | **There are no pull requests, so there is no GitHub-side review record.** Review evidence lives in issue comments and in CI. | Info | Keep the merge-commit audits (see [`pr-audit-124.md`](pr-audit-124.md)). Optionally enable branch protection on `main` that requires the CI checks. |
| A7 | **`.codex/config.toml` names specific models.** Changing a model is a config change and goes through review like any other. | Info | None. |

## 2. LLM features inside the app

| Concern | How Planora handles it | Evidence |
| --- | --- | --- |
| Prompt injection that leads to unwanted writes | The chat model can only *propose* actions. Every create, update, move or delete becomes a proposal card that the user must confirm. Write tools are separate from read tools, and confirmation is checked server-side, including against concurrent races. | `ai/propose_tools.py`, `domain/chat_actions.py`, `tests/integration/test_chat_action_confirm*.py` |
| Data sent to the LLM | Read tools return only metadata: title, status, category, priority and deadline. They never return `content`, `markdown_note` or URLs. Chat history replays proposal summaries, not the full task content. Quick capture sends the text the user typed. | `ai/chat_tools.py:15`, `ai/chat.py:106-110` |
| Secrets and content in logs | LLM requests and completions are logged only as counts, roles and token usage, never as text. The API key, site password and session secret are redacted, and so is the cookie value. | `ai/redact.py`, `logging.py`, `tests/**/test_*redaction*.py` |
| Provider failure | The API returns a fixed `AI_UNAVAILABLE` 503. The provider's status and body are never shown to the user. AI requests can be cancelled. | `ai/client.py`, `tests/integration/test_ai_disconnect.py` |
| Model choice | Only `LLM_MODEL` plus the models in `LLM_ALLOWED_MODELS` can be selected. Clients can't send arbitrary model names. | `domain/llm_models.py` |

## 3. Residual risk

- The LLM provider (Moonshot AI by default) receives task titles and chat text. See [`ai-tool-data-policy.md`](ai-tool-data-policy.md).
- An injected instruction inside a task title could still make the model propose a misleading action. The confirmation card shows the exact fields, which is the mitigation.
