# DocOps Policy (Update Declaration)

This project uses 4 docs as the external project memory:
- docs/state.md (SSOT, authoritative)
- docs/interfaces.md (contract)
- docs/decisions.md (append-only log)
- docs/roadmap.md (backlog, allowed to drift)

## Authority & Conflict Rules
1) state.md is the Single Source of Truth (SSOT). If any conflict exists, follow state.md.
2) interfaces.md is a contract. Code MUST follow it. Do not change API shapes in code unless interfaces.md is updated first.
3) decisions.md is append-only. Never rewrite or delete historical entries; only append new decisions.
4) roadmap.md is a planning backlog. It may be outdated; do not treat it as authoritative.

## Update Triggers
- Update state.md whenever:
  - A slice status changes (DONE/IN PROGRESS), OR
  - Run targets/ports/commands change, OR
  - Acceptance tests results change, OR
  - Any user-visible behavior changes.

- Update interfaces.md whenever:
  - Any request/response schema changes,
  - Any endpoint is added/removed/renamed,
  - Any internal interface contract changes (LLMProvider / MemoryStore / ToolRegistry).

- Update decisions.md whenever:
  - A non-trivial choice is made that may be revisited (framework, runtime, data store, API design, security stance).
  - Record as a new entry with date + short rationale.

- Update roadmap.md whenever:
  - A new feature request is discovered, OR
  - Slice order/priority changes.

## Backup & Rotation (Rollback depth = 1)
Before modifying any of the 4 docs, the agent MUST:
1) Create a one-level backup copy:
   - state.md.bak
   - interfaces.md.bak
   - decisions.md.bak
   - roadmap.md.bak
   (Overwrite existing .bak files if present.)

2) Apply the planned doc changes.

3) After changes, report:
   - Which docs were changed (and why)
   - A short changelog per doc (bullet points)

4) Cleanup rule:
   - Do NOT delete .bak automatically at the end of the same run.
   - .bak files are deleted ONLY at the start of the NEXT successful task run (right before creating new backups),
     so rollback depth stays exactly 1.

## Non-Fabrication Rule
The agent MUST NOT invent facts in docs.
If a required fact is unknown (e.g., exact runtime/model name), write "TBD" and add a checklist item instead.

## Output Format Requirements
When asked to implement a slice/task, the agent must output:
1) A small plan (<= 6 steps)
2) Code changes (patch/diff or full files)
3) Test/verification steps (commands + expected results)
4) Doc patches for the 4 docs (if triggered by rules above)