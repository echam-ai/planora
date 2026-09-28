"""Standalone background jobs (spec §19.2, issue #32).

Deliberately never imported by `planora_api.main` or anything under
`planora_api.api` — each job runs as its own process (the Compose
`scheduler` service, #43), not inside an API worker, so more than one
worker can never double-fire it. Every job here calls the domain and data
layers directly, never the HTTP API (issue #26's grooming note: a job
process has no browser `Origin` to present, and #26's CSRF middleware
would reject it).
"""

from __future__ import annotations
