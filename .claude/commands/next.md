---
description: Pick the next ready, unblocked issue and report its lane
---

Act as the orchestrator. Do not implement anything.

1. List open issues:
   ```bash
   gh issue list --repo hgiang/planora --state open --limit 60 \
     --json number,title,labels \
     --jq 'sort_by(.number) | .[] | "#\(.number) \(.title) [\(.labels|map(.name)|join(", "))]"'
   ```
2. Take the lowest-numbered candidate whose dependencies are met (`docs/PROCESS.md` → Orchestrator lists them), following the phase-7 deferral order in `docs/PROCESS.md` → Picking issues, and read its body with `gh issue view N --repo hgiang/planora`.
3. Judge readiness: substantive `Acceptance Criteria` checkboxes, executable `Test Scenarios`, explicit `Dependencies`, correct labels, no `needs grooming`. An absent label alone is not readiness.
4. Determine the lane from `docs/PROCESS.md` → Lanes.

Report, in under fifteen lines: the issue number and title, its lane, whether it is ready or needs grooming first, its dependencies and their state, and the single next action. Do not start the work.
