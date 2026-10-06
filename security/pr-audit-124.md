# PR audit — #124 "require a shared site password before the account chooser"

Planora merges locally rather than through GitHub pull requests (`docs/PROCESS.md` → "Merging — local only, no PRs"), so this audit is run against the merge commit's diff, which is exactly what a PR review would see.

- **Change:** merge `d601f04` (`claude/beautiful-galileo-h86qhc`), diffed against first parent `d601f04^1`. Whole merge: 106 files, +4655 / −304.
- **Reviewed:** security-relevant subset — `apps/api/src`, `deploy`, `scripts`, `apps/web/src/server.ts`, `apps/web/src/services/api/http`, `routes/login.tsx`, `routes/__root.tsx` (29 files, +714 / −51). Tests and generated `schema.gen.ts` skipped.
- **How:** an AI review agent (Claude, read-only) given the diff and a security checklist (auth bypass, cookie flags, token signing, CSRF, rate limiting, timing, log leakage, open redirect, gate exemptions, SSR cookie handling). Static review only. Findings F1 and F7 were spot-checked by hand afterwards.
- **Reproduce:** `git diff d601f04^1 d601f04 -- apps/api/src deploy scripts apps/web/src/server.ts apps/web/src/services/api/http apps/web/src/routes/login.tsx apps/web/src/routes/__root.tsx`

## Verdict: approve with comments

The design is sound:

- stateless HMAC token with a server-side expiry bound
- default-deny ASGI gate running before routing
- constant-time compare
- correct production cookie flags
- rate limiter keyed on the Caddy-observed address
- secrets kept out of logs and errors

No auth bypass, open redirect or CSRF gap was found. All findings are hardening items or documented trade-offs.

## Findings

| ID | Severity | Title | Location |
| --- | --- | --- | --- |
| F1 | Medium | Per-IP limit only (5 failures / 15 min); no global failure budget, so distributed or IPv6-rotating guessing of the single shared password is not throttled | `security/rate_limit.py:20-69`, `api/v1/auth.py:76-87` |
| F2 | Low | `record_failure` sweeps every tracked client on each failure, so cost per request is O(n) and grows as O(n²) overall; memory bounded only by distinct IPs per window | `security/rate_limit.py:58-63` |
| F3 | Low | 30-day bearer cookie, no per-session revocation (only rotating `SESSION_SECRET`/`APP_PASSWORD`); Lock clears one browser | `security/access.py:9-14,26`, `api/v1/auth.py:102-108` |
| F4 | Low | Setup HTTP mode (base `compose.yml` + `Caddyfile`, `auto_https off`) sends the password and a non-`Secure` cookie in cleartext | `security/access.py:81-83`, `deploy/Caddyfile` |
| F5 | Low | Clients with no peer address share one `"unknown"` limiter bucket | `api/v1/auth.py:51-54` |
| F6 | Info | `compare_digest` on raw strings can leak password length | `security/access.py:76-78` |
| F7 | Info | FastAPI `/docs`, `/redoc`, `/openapi.json` are enabled and ungated (outside `/api/v1/`); unreachable via Caddy in Compose, but exposed if the API image runs standalone | `main.py:71`, `security/access_gate.py:28-36` |
| F8 | Info | Cookie lacks the `__Host-` prefix (already meets its requirements in https mode) | `security/access.py:25` |
| F9 | Info | Rejected/blocked logins log the client IP at WARNING (personal data, operationally needed) | `api/v1/auth.py:79,86` |
| F10 | Info | Gate's 401 lacks `Cache-Control: no-store` (auth routes set it) | `security/access_gate.py:64-68` |

## Recommendations

| Finding | Recommendation |
| --- | --- |
| F1 | Add a site-wide failure budget or a progressive delay; bucket IPv6 by /64; optionally add edge rate limiting at Caddy. |
| F2 | Cap the size of the failures map, or sweep lazily (amortised or with a time-ordered queue). |
| F3 | Accept, or shorten the lifetime to 7 days; optionally add a `SESSION_EPOCH` counter so all cookies can be revoked without changing secrets. |
| F4 | Document that setup mode must stay on loopback or a private network; warn at startup when `APP_ORIGIN` is `http` and the host isn't loopback. |
| F5 | Fail closed (reject the request) when no client address is present. |
| F6 | Compare fixed-length digests, e.g. `compare_digest(sha256(a).digest(), sha256(b).digest())`. |
| F7 | Pass `docs_url=None, redoc_url=None, openapi_url=None` in production; the OpenAPI export calls `app.openapi()` directly and doesn't need the routes. |
| F8 | Name the cookie `__Host-planora_access` when it is `Secure`. |
| F9 | Keep as is; mention it in [`ai-tool-data-policy.md`](ai-tool-data-policy.md) retention notes. |
| F10 | Add `Cache-Control: no-store` to the gate's 401. |

## Verified strengths

- **Token.**
  - HMAC-SHA256 with a key derived from `SESSION_SECRET` + `APP_PASSWORD` and a domain-separation context.
  - Strict three-part `v1.<expiry>.<sig>` format, constant-time signature check, and no exceptions on malformed input.
  - Expiries more than one lifetime ahead are rejected.
- **Secrets config.**
  - `SESSION_SECRET` must be at least 32 chars and `APP_PASSWORD` at least 12, with no defaults.
  - Startup errors render only validator messages, never values.
  - Compose uses `:?` so it fails when either is missing.
- **Cookie.** `HttpOnly`, `SameSite=Lax`, `Path=/`, `Max-Age` set, and `Secure` whenever the origin is https (production derives `https://${PLANORA_DOMAIN}`). Login and session responses are `no-store`.
- **Gate.**
  - Allow-list is only `/api/v1/health` (exact) and `/api/v1/auth/*`; new routes are gated by default.
  - Trailing-slash, `//` and `..` tricks are handled: trailing slashes and `//` get 401, and `..` paths match no route.
- **CSRF.** Exact `Origin` match on every non-safe method, including login and logout.
- **Rate-limit key.**
  - Uses the ASGI client host only; uvicorn trusts forwarded headers only from the fixed `CADDY_IP`.
  - Caddy overwrites `X-Forwarded-For` and strips `Forwarded`/`X-Real-IP`.
  - There's no `await` between check and record, so requests can't race past the limit.
- **Logs.** Password and secret are on the redaction list in the API and both jobs, the cookie value is regex-redacted, and error messages are fixed strings.
- **No open redirect.** There is no `next`/`redirect` parameter, and the native `POST /login` fallback always returns `303 → /login`.
- **SSR.**
  - Never forwards cookies or calls the API server-side; SSR renders the `"unknown"` access state only.
  - The client uses `credentials: "same-origin"`.
- **Demo password.** `focusboard` exists only in the mock client and is stripped from `VITE_API_MODE=http` builds.

## Not reviewed

- Test files.
- Remaining web files in the merge: `AppShell.tsx`, `queryClient.ts`, `mockApiClient.ts`.
- Runtime probing.
- Caddy security headers (HSTS/CSP), which this merge didn't change.
- Dependency CVEs (see [`scan-findings.md`](scan-findings.md)).
