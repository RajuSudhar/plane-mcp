# Plans

Phased rollout of the Plane MCP server.

- `TRACK.md` — live status board. Always update when a feat moves state.
- `phase-<n>/feat-<slug>/plan.md` — per-feature plan. ADR-lite format.

## Plan format (mandatory)

```text
# feat-<slug>

Phase: <n>  |  Status: [ ] todo / [~] wip / [x] done / [!] blocked
Depends on: <list of feat slugs>
Ref: <claude-ref files relevant to this feat>

## Goal
One sentence.

## In scope
- bullet

## Out of scope
- bullet

## Design
Shape of types, module boundaries, key decisions. Keep terse.

## Tasks
- [ ] atomic, verifiable step
- [ ] ...

## Definition of done
- [ ] tests pass (unit + type)
- [ ] coverage target met
- [ ] logger calls at all critical paths
- [ ] docs touched where needed
- [ ] TRACK.md updated

## Open questions
- ...
```

## Rules

- Never start a feat without opening its `plan.md`.
- Mark `[~]` in both the plan and `TRACK.md` at start.
- Mark `[x]` only after the DoD checklist is complete.
- Cross-phase dependency? Add it to `Depends on:` and block until upstream is `[x]`.
