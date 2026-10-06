# Security, audit and DevOps hardening

This folder holds the review artifacts for Planora's security and operations. Each one can be regenerated from the repository.

| Artifact | What it is | How it's produced |
| --- | --- | --- |
| [`scan-findings.md`](scan-findings.md) | Triaged results from 6 deterministic scanners (SAST, secrets in tree and history, CI workflow audit, Python and npm dependency CVEs) | [`run-scans.sh`](run-scans.sh) → raw output in [`reports/`](reports/) |
| [`pr-audit-124.md`](pr-audit-124.md) | Security review of the #124 change (the shared site password gate) | AI review agent run over `git diff d601f04^1 d601f04`, then spot-checked by hand |
| [`agent-security-notes.md`](agent-security-notes.md) | Risks in the coding-agent setup (`.claude/`, `.codex/`, `.agents/`) and in the app's own LLM features | Manual review of the permission rules, role files and AI modules |
| [`ops-diagnosis.md`](ops-diagnosis.md) | Snapshot of the running production stack: service health, TLS, backups, errors and resources | [`scripts/ops-diagnose.sh`](../scripts/ops-diagnose.sh) run on the VPS |
| [`ai-tool-data-policy.md`](ai-tool-data-policy.md) | Which AI tools may see what data, and what the app sends to its LLM provider | Written policy |

## Current status (commit `786ec23`)

- **Critical/high:** none open.
- **Medium:**
  - CI actions are not pinned to commit SHAs (S1).
  - Login brute-force is limited per IP only (F1).
  - Agent permissions allow `bun install <pkg>` and an unrestricted `Read` (A2, A3).
  - Agents treat issue text from the public tracker as instructions (A1).
- **Low/info:** tracked in each file with a recommendation.

## Rerun

```bash
security/run-scans.sh            # writes raw reports to .tmp/security-reports/
```

The script uses only `uv`/`uvx`, plus gitleaks and trivy if they're installed.
