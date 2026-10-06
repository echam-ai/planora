# Deterministic security scan findings

Scanned commit `786ec23` (main) on 2026-10-05. Raw outputs are in [`reports/`](reports/); rerun everything with [`run-scans.sh`](run-scans.sh).

## Tools and results

| Tool | Version | Target | Raw output | Result |
| --- | --- | --- | --- | --- |
| Semgrep (community rules, offline) | 1.179.0 | Python, TS/JS, Dockerfiles, GitHub Actions, generic secrets (846 rules, 241 files; tests excluded) | [`semgrep.json`](reports/semgrep.json) | 230 hits → **2 real (low)**, rest false positive / style |
| Bandit | 1.9.4 | `apps/api/src`, `deploy/backup.py` (5,703 LOC) | [`bandit.json`](reports/bandit.json) | 0 high, 0 medium, 12 low → all accepted |
| zizmor | 1.30.1 | `.github/workflows/ci.yml` | [`zizmor.txt`](reports/zizmor.txt) | 18 unpinned actions, 5 credential persistence → **real (low/medium)** |
| detect-secrets | 1.5.0 | Working tree + full git history (280 commits) | [`detect-secrets.json`](reports/detect-secrets.json), [`history summary`](reports/detect-secrets-history-summary.json) | 76 tree hits + 1,268 history hits → **0 real secrets** |
| pip-audit | 2.10.1 | `uv.lock` (exported, 36 runtime + dev packages) | [`pip-audit.json`](reports/pip-audit.json) | **0 known vulnerabilities** |
| npm advisory DB (bulk API) | — | `apps/web/bun.lock` (495 packages, 535 versions) | [`npm-advisories.json`](reports/npm-advisories.json) | **1 low** (dompurify) |

## Triaged findings

| ID | Severity | Finding | Source | Status |
| --- | --- | --- | --- | --- |
| S1 | Medium | GitHub Actions referenced by tag, not commit SHA (18 uses, incl. third-party `oven-sh/setup-bun`, `astral-sh/setup-uv`). A re-tagged action runs arbitrary code in CI. | zizmor `unpinned-uses`, Semgrep `third-party-action-not-pinned-to-commit-sha` | Open: pin to SHAs (`zizmor --fix` / Dependabot) |
| S2 | Low | `actions/checkout` keeps the job token in `.git/config` (`persist-credentials` not false); 5 jobs. Workflow `permissions: contents: read` limits impact. | zizmor `artipacked` | Open: add `persist-credentials: false` |
| S3 | Low | `dompurify 3.4.15` — GHSA-p98j-92pf-mc4p (IN_PLACE mode + node-removing `afterSanitize` hook). Planora uses neither `IN_PLACE` nor a node-removing hook (its `afterSanitizeAttributes` hook only removes attributes, `apps/web/src/lib/markdown-html.ts:48`), so not exploitable. | npm advisory | Open: bump to `3.4.16` |
| S4 | Low | Docker base images pinned by tag, not digest (`python:3.12-slim-bookworm`, `node:24-bookworm-slim`, `oven/bun:1.4.2`, `caddy`, `postgres`). | Semgrep `dockerfile-source-not-pinned` | Accepted for now; tags are exact versions |

## False positives / accepted (with reasons)

- **Secrets (detect-secrets, Bandit B105/B106, Semgrep generic).** Every tree hit is an env-var *name* (`"APP_PASSWORD"`), a fixed UI message (`"Incorrect password."`), a disposable CI/test fixture (`disposable-ci-…`, `issue45-database-marker`), the OpenAPI export placeholder (`openapi-export-placeholder-password`), Alembic revision hashes, or the mock-mode demo password `focusboard` (only shown in `VITE_API_MODE=mock`, and shorter than the 12-char minimum so it can never be a real `APP_PASSWORD`). History hits are the same fixtures plus lockfile integrity hashes. A pattern search of the full history for real key formats (`sk-…`, `ghp_`, `github_pat_`, `AKIA…`, `xox?-`, `AIza…`, `BEGIN … PRIVATE KEY`) returned **nothing**; only `.env.example` files were ever committed.
- **Bandit B101 `assert_used` (7).** Internal invariants in repositories/domain, not input validation. Accepted.
- **Bandit B404 `subprocess`** in `deploy/backup.py` — calls `pg_dump`/`pg_restore` with fixed argv, no shell. Accepted.
- **Semgrep `avoid-sqlalchemy-text`** in migration `209e984e239b` — f-string table names come from a hard-coded tuple, no user input. Accepted.
- **Semgrep `useless-inner-function` (6)** — FastAPI `@app.exception_handler` closures; registered by decorator. False positive.
- **Semgrep `return-not-in-function` (4)** — lambdas in a dict. False positive.
- **Semgrep INFO `jsx-not-internationalized` (115), `react-props-spreading` (66)** — style rules; shadcn/ui components spread props by design. Not security.

## Not covered

- Container image CVE scanning (Trivy/Grype) and gitleaks: their binaries are distributed via GitHub Releases, which were not reachable from the scan environment. `run-scans.sh` runs them when installed locally.
- Dynamic testing (DAST) of the running app.
