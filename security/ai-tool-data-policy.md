# AI tool and data policy

This policy covers two things: the AI tools used to **build** Planora, and the AI provider the **running app** sends data to.

## 1. AI tools used in development

| Tool | Use | Allowed data |
| --- | --- | --- |
| Claude Code (Anthropic) | Orchestrator and role agents (`.agents/`), slash commands | Source code, docs, issue text, and test and CI output |
| Codex (OpenAI) | The same roles, via `.codex/agents/` | Same as above |
| Claude (Cowork) | Security scans, PR audit, README | Same as above |

**Rules**

1. **No real secrets go into prompts, issues or commits.** Agents must not read or paste `apps/api/.env`, `deploy/*.env`, runtime env files or database dumps (see [`agent-security-notes.md`](agent-security-notes.md), A3). Use the `.env.example` files and the disposable CI values instead.
2. **No production data in agent sessions.** Debug with seeded or fixture data (`apps/web/e2e-http/seed.py`, the mock API). If a production log has to be shared, share only the redacted application log, which by design never contains task content or chat text.
3. **A human approves anything that leaves the machine.** `git push` and `git merge` prompt for approval, PR tooling is denied, and force-push is forbidden in both harnesses.
4. **Agent output is reviewed before merge.** It goes through the independent tester gate, PM acceptance (full lane) and CI (`docs/PROCESS.md`). AI-generated security reviews are advisory, and findings are spot-checked by hand.
5. **No AI attribution in history** (binding rule 11). The owner is accountable for every commit.
6. **New dependencies** are added only through `bun`/`uv` lockfiles from the public registries. Any new AI SDK or telemetry service needs an ADR (binding rule 7).

## 2. AI provider used by the running app

| Item | Value |
| --- | --- |
| Provider | Any OpenAI-compatible endpoint. The default is Moonshot AI (`LLM_BASE_URL=https://api.moonshot.ai/v1`, `LLM_MODEL=kimi-k3`). |
| Credentials | `LLM_API_KEY` is kept server-side only. It is never sent to the browser, never logged, and is redacted in errors. |
| Features | Quick-capture parsing (`POST /api/v1/ai/parse-task`) and the chat assistant. |

**Data sent to the provider**

- *Quick capture:* the text the user typed, plus the current time and timezone.
- *Chat:* the user's messages and the assistant's earlier replies. For tool results, only task metadata is sent: title, status, category, priority, deadline and timestamps. Task `content`, `markdown_note` and URLs are **never** included in tool results or history.
- Never sent: the site password, the session cookie, other profiles' data, or backups.

**Data stored by Planora**

- Chat messages and proposals live in the app database, scoped to each profile. They are included in backups (7 retained, per `docs/ops/backup-restore.md`). Deleting a task does not delete earlier chat text.
- Logs hold metadata only: counts, roles, token usage and outcome. Failed logins record the client IP at WARNING level.

**Users' choices**

- Leave `LLM_API_KEY` as a placeholder to run with no AI. The board, archive and search all work, and the AI features report "unavailable".
- Point `LLM_BASE_URL` at another provider, or at a self-hosted OpenAI-compatible model, to change where the data goes.
- Check the provider's own retention and training terms before putting sensitive tasks into chat. Planora cannot control what the provider does with requests.

**Change control**

Changing the default provider, adding new fields to what the LLM receives, or adding a new AI feature needs all three of:

- a spec update
- a matching redaction test (`tests/**/test_*redaction*.py`)
- an update to this policy
