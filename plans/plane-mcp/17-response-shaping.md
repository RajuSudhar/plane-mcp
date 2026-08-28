# feat-response-shaping

Phase: 17 | Status: [ ] todo
Depends on: 16-secure-setup
Ref: `plans/plane-mcp/00-rfc.md` (Proposed design amendment, 2026-08-15), `docs/plane-api-reference.md` §2.6, §7, `types/client.ts`, `types/plane.ts`

## Goal

Build the single shared seam every later phase in this feature composes:
an allowlist-based field-projection + long-text-truncation helper
(`src/plane/select.ts` + `types/select.ts`), plus the small `PlaneApi`
query-param groundwork needed to push a resolved `fields=` list down to
Plane for the two resources that already wire it (projects, work items).
No tool's registered behavior changes in this phase — it is pure
foundation, proven by unit tests against the helper functions directly.

## Problem

Every `list_*`/`retrieve_*` tool currently does `JSON.stringify(data)` on
the object `PlaneApi.get<T>()` returns. The generic type parameter `T`
(`Project`, `WorkItem`, etc.) is a compile-time annotation only — at
runtime `JSON.parse(text) as T` returns whatever JSON Plane actually sent,
which is materially wider than the hand-typed shapes in `types/plane.ts`.
Concretely: `docs/plane-api-reference.md` §7.2 documents 21 fields on the
wire-level `Project` object (vs. our 9-field `Project` type), and
production Plane responses are known to carry additional undocumented
fields on top of that (`logo_props`, `timezone`, `total_members`, extra
creator/lead UUID fields) that appear in neither the reference doc nor our
type. Because `Project`/`WorkItem`/etc. are read-shape types with no
runtime validation (no Zod parse on the response path — only on tool
input), `JSON.stringify` always serializes the full raw object regardless
of what the TypeScript type claims. Every `list_*` call therefore returns
one full raw object per row; every `retrieve_*` call returns one full raw
object including complete `description_html`/`description`. This is the
context-volume problem this feature reduces.

## In scope

- `types/select.ts` — `ProjectionSpec<T>`, `ProjectionOptions`,
  `TruncationResult` types.
- `src/plane/select.ts` — allowlist pick + truncation implementation:
  `pickFields`, `resolveFieldList`, `truncateText`, `projectItem`,
  `projectList`, `projectEnvelope`.
- `src/plane/select.test.ts` — unit tests for every exported function,
  including the allowlist-robustness property (undocumented/unexpected
  keys on the raw input are never present on the output unless
  explicitly requested via `fields`).
- Extend `types/client.ts`'s `RequestOptions`/`PlaneApi.get` query type
  only if the existing `Record<string, string | number | boolean |
undefined>` shape cannot carry a comma-joined `fields` string (it already
  can — confirm and document, do not widen the type speculatively).
- `types/index.ts` — add `export type * from './select';`.

## Out of scope

- Wiring `projectItem`/`projectList`/`projectEnvelope` into any of the 13
  tools named in the RFC amendment — that is Phases 18-19. This phase ships
  a helper with 100% test coverage and zero call sites.
- Changing any tool's `description` string or `inputSchema` — Phase 20.
- Changing `PlaneClient`'s retry/error/pagination behavior — untouched.

## Design

### `types/select.ts`

```typescript
// Per-resource default projection + optional truncation rule, built once
// per resource and reused by every tool for that resource.
export type ProjectionSpec<T extends Record<string, unknown>> = {
  // Field names always included unless `full` is set.
  defaultFields: readonly (keyof T & string)[];
  // Long-text fields eligible for truncation, with their own default cap.
  // Only applied when `projectItem`/`projectList` is called with
  // `truncate: true` (retrieve-by-id tools); list tools that include a
  // long-text field (comments) pass their own explicit maxChars instead
  // — see Phase 18 Design.
  truncatable?: readonly { field: keyof T & string; defaultMaxChars: number }[];
};

// Per-call options every projected tool exposes as optional zod params.
export type ProjectionOptions = {
  // Extra raw field names to merge into defaultFields. Order-independent,
  // deduplicated against defaultFields.
  fields?: string[];
  // Bypass projection and truncation entirely — returns the object
  // exactly as Plane sent it (today's behavior).
  full?: boolean;
  // Overrides every truncatable field's defaultMaxChars for this call.
  // Ignored when full is true.
  maxChars?: number;
};

export type TruncationResult = {
  text: string;
  truncated: boolean;
  omittedChars: number;
};
```

### `src/plane/select.ts`

```typescript
import type { ProjectionOptions, ProjectionSpec } from '@types';

export function resolveFieldList<T extends Record<string, unknown>>(
  spec: ProjectionSpec<T>,
  opts: ProjectionOptions
): string[] {
  const extra = opts.fields ?? [];
  return Array.from(new Set<string>([...spec.defaultFields, ...extra]));
}

export function pickFields<T extends Record<string, unknown>>(
  source: T,
  fieldNames: readonly string[]
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of fieldNames) {
    if (key in source) {
      result[key] = source[key];
    }
  }
  return result;
}

const DEFAULT_TRUNCATION_MARKER = (omittedChars: number): string => `… [truncated, ${omittedChars} chars omitted]`;

export function truncateText(value: string, maxChars: number): TruncationResult {
  if (value.length <= maxChars) {
    return { text: value, truncated: false, omittedChars: 0 };
  }
  const omittedChars = value.length - maxChars;
  return {
    text: value.slice(0, maxChars) + DEFAULT_TRUNCATION_MARKER(omittedChars),
    truncated: true,
    omittedChars,
  };
}

export function projectItem<T extends Record<string, unknown>>(
  source: T,
  spec: ProjectionSpec<T>,
  opts: ProjectionOptions,
  applyTruncation: boolean
): Record<string, unknown> {
  if (opts.full) {
    return source;
  }
  const picked = pickFields(source, resolveFieldList(spec, opts));
  if (!applyTruncation || !spec.truncatable) {
    return picked;
  }
  for (const rule of spec.truncatable) {
    const raw = picked[rule.field];
    if (typeof raw === 'string') {
      const maxChars = opts.maxChars ?? rule.defaultMaxChars;
      picked[rule.field] = truncateText(raw, maxChars).text;
    }
  }
  return picked;
}

export function projectList<T extends Record<string, unknown>>(
  items: readonly T[],
  spec: ProjectionSpec<T>,
  opts: ProjectionOptions,
  applyTruncation: boolean
): Record<string, unknown>[] {
  return items.map((item) => projectItem(item, spec, opts, applyTruncation));
}
```

`projectEnvelope` is intentionally **not** a generic wrapper around
`PaginationEnvelope<T>` in this phase — Phase 18's per-tool call sites
build the shaped envelope object explicitly (spread the 7 metadata fields,
replace `results` with `projectList(...)`, drop `extra_stats` by default).
A generic `projectEnvelope<T>` helper was considered and rejected here:
`PaginationEnvelope<T>`'s `extra_stats: Record<string, unknown>` field has
no fixed shape to allowlist against, so a generic wrapper would either
always drop it (fine, but then the wrapper adds no value over inline
spreading) or always keep it (defeats the point). Each Phase 18 tool
spreads the envelope explicitly; this keeps the one genuinely resource-
agnostic seam (`pickFields`/`truncateText`/`projectItem`/`projectList`)
free of pagination-envelope-specific judgment calls.

### Query-param pushdown groundwork

`PlaneApi.get<T>(path, query?)`'s query type is already
`Record<string, string | number | boolean | undefined>` (`types/client.ts`),
which can carry a comma-joined `fields` string today — `list_projects` and
`retrieve_project`/`list_work_items`/`retrieve_work_item` already pass
`args.fields` straight through. No type change is required. Phase 18/19
call sites will build this string via
`resolveFieldList(spec, opts).join(',')` and pass it as the `fields` query
param **only** for the two resources with already-verified server-side
`fields=` support (projects, work items) — see Phase 18/19 Design for the
full per-resource pushdown decision table. This phase does not wire any
call site; it only confirms (via the design note above, and via this
phase's tests) that no `PlaneApi`/`RequestOptions` type change is needed.

## Tasks

- [ ] Write `types/select.ts` (`ProjectionSpec`, `ProjectionOptions`,
      `TruncationResult`)
- [ ] Add `export type * from './select';` to `types/index.ts`
- [ ] Write `src/plane/select.ts` (`resolveFieldList`, `pickFields`,
      `truncateText`, `projectItem`, `projectList`)
- [ ] Write `src/plane/select.test.ts`:
  - [ ] `pickFields` returns only requested keys present on the source,
        silently skips missing keys, never invents `null`/`undefined`
        placeholders
  - [ ] `pickFields` allowlist property: given a source object with keys
        outside `defaultFields` (simulating Plane's undocumented extra
        fields), those keys never appear in the output unless named in
        `opts.fields`
  - [ ] `resolveFieldList` dedupes when `opts.fields` overlaps
        `defaultFields`
  - [ ] `truncateText` — under-limit string returned unchanged,
        `truncated: false`; over-limit string sliced to exactly
        `maxChars` plus marker, `truncated: true`, `omittedChars` matches
        the actual delta
  - [ ] `projectItem` with `opts.full: true` returns the source object
        reference unmodified (including any field outside the spec)
  - [ ] `projectItem` with `opts.maxChars` overrides
        `spec.truncatable[].defaultMaxChars`
  - [ ] `projectItem` with `applyTruncation: false` picks fields but never
        touches a truncatable field's length
  - [ ] `projectList` maps `projectItem` over every array element,
        preserving order
- [ ] Run `bun test` — all green
- [ ] Run `bun run typecheck` — passes
- [ ] Run `bun run check` — passes (format + lint, including type-aware
      rules)

## Definition of done

- [ ] `src/plane/select.ts` exports `resolveFieldList`, `pickFields`,
      `truncateText`, `projectItem`, `projectList` — zero tool call sites
      yet, 100% branch coverage via `src/plane/select.test.ts`
- [ ] No existing tool's registered behavior, `inputSchema`, or
      `description` changes in this phase (verified by re-running the
      full existing `src/tools/*.test.ts` suite unmodified and green)
- [ ] `docs/plans/TRACK.md` updated: Phase 17 row `[~]` at start, `[x]` at
      completion

## Open questions

- None — this phase is pure new-code addition with no existing call site
  to reconcile; the per-resource default field sets and pushdown decision
  table are specified in Phase 18/19, not here.
