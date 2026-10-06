#!/usr/bin/env bash
# Re-run the deterministic security scans recorded in security/scan-findings.md.
# Usage (from the repository root): security/run-scans.sh [output-dir]
# Needs only `uv` (tools run through `uvx`, binding rule 8) and network access
# to PyPI, the Semgrep registry and the npm advisory API. gitleaks and trivy run
# when installed; otherwise they are skipped with a note.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
OUT="${1:-$ROOT/.tmp/security-reports}"
mkdir -p "$OUT"
cd "$ROOT"
echo "Scanning $(git rev-parse --short HEAD) -> $OUT"

echo "== semgrep"
uvx semgrep scan --metrics=off --disable-version-check \
  --config p/python --config p/typescript --config p/javascript \
  --config p/dockerfile --config p/github-actions --config p/secrets \
  --exclude tests --exclude e2e --exclude e2e-http \
  --exclude '*.test.ts' --exclude '*.test.tsx' --exclude schema.gen.ts \
  --json -o "$OUT/semgrep.json" . || true

echo "== bandit"
uvx bandit -q -r apps/api/src deploy/backup.py -f json -o "$OUT/bandit.json" || true

echo "== zizmor"
uvx zizmor --format plain .github/workflows/ci.yml > "$OUT/zizmor.txt" 2>&1 || true

echo "== detect-secrets (tree)"
uvx detect-secrets scan --all-files \
  --exclude-files '(bun\.lock|uv\.lock|schema\.gen\.ts|openapi\.json)$' > "$OUT/detect-secrets.json"

echo "== pip-audit (apps/api/uv.lock)"
(cd apps/api && uv export --frozen --no-hashes --no-emit-project --all-groups) > "$OUT/api-requirements.txt"
uvx pip-audit -r "$OUT/api-requirements.txt" --no-deps --disable-pip -f json -o "$OUT/pip-audit.json" || true

echo "== npm advisories (apps/web/bun.lock)"
uv run --no-project python - "$OUT/npm-advisories.json" <<'PY'
import json, re, sys, urllib.request
text = re.sub(r",(\s*[}\]])", r"\1", open("apps/web/bun.lock").read())
packages = {}
for entry in json.loads(text)["packages"].values():
    name, version = entry[0].rsplit("@", 1)
    packages.setdefault(name, set()).add(version)
request = urllib.request.Request(
    "https://registry.npmjs.org/-/npm/v1/security/advisories/bulk",
    data=json.dumps({k: sorted(v) for k, v in packages.items()}).encode(),
    headers={"content-type": "application/json"},
)
result = json.load(urllib.request.urlopen(request, timeout=60))
json.dump(result, open(sys.argv[1], "w"), indent=1)
for name, advisories in result.items():
    for a in advisories:
        print(f"  {a['severity']:8} {name} {a['vulnerable_versions']} {a['url']}")
print(f"  {len(packages)} packages checked")
PY

if command -v gitleaks >/dev/null; then
  echo "== gitleaks (full history)"
  gitleaks git --redact --report-format json --report-path "$OUT/gitleaks.json" . || true
else
  echo "== gitleaks not installed, skipped"
fi

if command -v trivy >/dev/null; then
  echo "== trivy (repo filesystem + IaC)"
  trivy fs --scanners vuln,misconfig,secret --format json -o "$OUT/trivy.json" . || true
else
  echo "== trivy not installed, skipped"
fi

echo "Done. Triage new hits in security/scan-findings.md."
