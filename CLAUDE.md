@AGENTS.md

Project instructions live in `AGENTS.md` and role policy in `.agents/`, both harness-neutral and shared with Codex. This file holds only what is specific to Claude Code.

## Claude Code setup

| Path | What it does |
| --- | --- |
| `.claude/agents -> ../.agents` | Registers the six roles natively. Check `/agents` in a fresh session. Preserve the symlink; never copy role files. |
| `.claude/settings.json` | Permission allowlist so pipeline commands do not prompt, and a denylist that enforces two binding rules mechanically. |
| `.claude/commands/` | Slash commands for the pipeline stages, so the orchestrator does not re-derive them from prose each session. |

### Slash commands

`/next` pick and report the next ready issue · `/issue N` run the full pipeline for one issue · `/verify` run the stage-appropriate checks and report evidence · `/ship N` merge, push and clean up.

### What the permissions enforce

Denied outright, matching `AGENTS.md` and `docs/PROCESS.md`: `gh pr create` and `gh pr merge` (the agent flow is the review), `npm install`, `npx` and `pip install` (binding rule 8), edits to `routeTree.gen.ts` and `schema.gen.ts` (binding rule 4), `git push --force` and `git reset --hard`.

Prompting rather than silent: `git push`, `git merge`, `git worktree remove`, branch deletion — all orchestrator-owned steps that deserve a look.

A command that still prompts unexpectedly is usually a wrapper the rules do not match (an env-var prefix, a subshell). Do not disable the sandbox to get around it; run the bare command or add a rule.

### Per-role models

`.agents/` stays harness-neutral, so it pins no model and no tool list — `model:`/`tools:` frontmatter is Claude Code syntax and does not belong in a file Codex also reads. `docs/PROCESS.md` states the *reasoning strength* each role needs; this is the Claude mapping, passed as the `model` argument when dispatching with the Agent tool:

| Role | Model | Why |
| --- | --- | --- |
| `product-manager`, `designer` | `opus` | Misreading the spec or missing an accessibility rule is expensive and surfaces late |
| `web-engineer`, `api-engineer`, `tester`, `oncall-engineer` | `sonnet` | Implementation, suite runs and CI triage are bounded by criteria that already exist |

Tool restrictions come from `.claude/settings.json`, which applies to every agent, rather than per-role frontmatter. The read-only roles state their own limits in their bodies (`designer` reports and never implements; `tester` hands work back instead of fixing it).

### Keeping sessions fast

Read only what the lane needs. Full-lane application work needs `AGENTS.md`, `docs/PROCESS.md` and one role file; `docs/BROWSER-VERIFICATION.md` is for issues that actually drive a browser, and the spec is read by section, not whole. Hand reviewers a base SHA and let them run `git diff` — never copy a worktree into `.tmp/`.
