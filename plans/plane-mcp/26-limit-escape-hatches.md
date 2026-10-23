# feat-limit-escape-hatches

Depends on: Phase 22 (`ServerConfig`), Phase 23 (reject-and-guide enforcement).
Does not depend on Phase 19 — see "Relationship to Phase 19".

## Goal

When a tool result breaches the output-token limit, give the caller two escape
hatches that actually work, and describe only the ones the breaching tool
supports:

1. **Narrow the response** — `fields` (and `per_page` where the endpoint
   paginates) on every collection-returning tool.
2. **Raise the limit for that one request** — a `max_output_tokens` argument,
   bounded by a configured ceiling.

## Problem

Phase 23 ships one generic guidance string for every tool:

> …for example: pass `fields` to request specific fields instead of the full
> object, reduce `per_page`, filter `list_work_items`/`search_work_items` by
> `module_id` or `cycle_id`…

Two defects, both confirmed against a live Community instance on 2026-09-07:

**(a) The advice names parameters the failing tool does not have.** Eight tools
accept `project_id` alone (or nothing): `list_states`, `list_labels`,
`list_cycles`, `list_modules`, `list_work_item_comments`,
`list_work_item_relations`, `get_project_members`, `get_workspace_members`.
A caller that follows the guidance retries with `fields`, gets a Zod validation
error, and has no next move. Observed: a Haiku-class agent blocked correctly but
echoed the impossible advice back to the user as the remediation.

**(b) There is no per-request escape hatch at all.** The only lever is the
config file or `PLANE_MCP_MAX_OUTPUT_TOKENS`, both of which require restarting
the server. A model mid-conversation cannot act on either.

Measured on one real project (`docs/plane-api-reference.md` §2.6 confirms
`fields` is supported on every endpoint, so these are all narrowable in
principle — the tools just don't expose it):

| Tool           | Response    | Limit  | Narrowable today |
| -------------- | ----------- | ------ | ---------------- |
| `list_labels`  | 463,416 tok | 25,000 | no               |
| `list_cycles`  | 157,122 tok | 25,000 | no               |
| `list_modules` | 42,377 tok  | 25,000 | no               |

Consequence: duplicate-checking in `plane-taxonomy-ops`, container resolution by
name in `plane-cycle-module-ops`, and label resolution in
`plane-work-item-write` are all dead on a project this size. Raising the limit
cannot fix `list_labels` — 463k tokens exceeds any usable context window, so
`fields` is the only real remedy there. That is why both hatches ship together.

## In scope

**Passthrough params.** Add to the tools that lack them, forwarded to Plane as
query params, no client-side projection:

| Tool                                                                                    | Adds                                     | Current return shape |
| --------------------------------------------------------------------------------------- | ---------------------------------------- | -------------------- |
| `list_states`, `list_labels`, `list_cycles`, `list_modules`, `list_work_item_relations` | `fields`, `expand`                       | bare array           |
| `get_project_members`, `get_workspace_members`                                          | `fields`, `expand`                       | bare array           |
| `list_work_item_comments`                                                               | `fields`, `expand`, `cursor`, `per_page` | pagination envelope  |
| `search_work_items`                                                                     | `fields`, `expand`                       | pagination envelope  |

⚠ **Deviation from the original draft of this plan.** `cursor`/`per_page` are
NOT added to the seven bare-array tools. Those endpoints currently return a raw
`T[]`, which the tool layer casts (`client.get<State[]>`) and wraps
(`structuredContent: { states: data }`). Plane returns the pagination envelope
for paginated requests, so passing `per_page` could silently switch the response
from array to envelope — breaking both the cast and the wrapper with no type
error, since the cast is unchecked at runtime. `fields`/`expand` only subset
keys and cannot change the container, so they are safe to add blind. Adding
pagination to those seven requires confirming the shape against a live instance
per endpoint and handling both shapes; deferred rather than guessed. `fields`
alone already delivers the win — it is what takes `list_labels` from 463k
tokens to a few hundred.

`list_projects`, `list_work_items`, `retrieve_project`, `retrieve_work_item`
already have `fields`/`expand` — unchanged.

**Per-request limit override.** `max_output_tokens?: number` (positive integer)
on the 14 collection- or object-returning tools: the 10 above plus
`list_projects`, `list_work_items`, `retrieve_project`, `retrieve_work_item`,
`retrieve_work_item_by_identifier`. Resolution precedence:

```
request max_output_tokens  >  tools.<name>.maxOutputTokens  >  PLANE_MCP_MAX_OUTPUT_TOKENS  >  defaults.maxOutputTokens  >  25000
```

**Ceiling.** New `defaults.maxOutputTokensCeiling`, default `100000`. A request
override above the ceiling is rejected before the API call, naming the ceiling
and the config key. Config-file and env limits are NOT ceiling-checked — an
operator setting them is making a deliberate deployment choice; the ceiling
exists to stop a model from pulling a payload that destroys its own context.

**Tool-aware guidance.** `buildTokenLimitGuidance` takes the breaching tool's
capability set and emits only applicable remedies, always including the
`max_output_tokens` retry with a concrete suggested value.

**The 14 write/small tools are untouched.** They return one small object;
`create_state` cannot breach 25k.

## Out of scope

- Default per-item projections and the `full` escape hatch — Phase 19.
- Long-text truncation (`max_description_chars`) — Phase 20.
- Collapsing `content`/`structuredContent` duplication — still Phase 19/20.
- Auto-retry inside the server. The model decides whether to narrow or raise.

## Relationship to Phase 19

Phase 19 (`19-list-projections.md`, still `[ ]`) specs _default_ projections —
every list tool returns a minimal field set unless `full` is passed. This phase
ships only the _passthrough_ half: the parameter exists and is forwarded, but
the default remains whatever Plane returns. The two compose without conflict:
Phase 19 later changes the default, this phase makes the knob exist. Shipping
passthrough first turns three dead tools into working ones without waiting for
Phase 19's much larger client-side-projection design.

⚠ Phase 18's client-side filtering constraint still holds: for
`list_work_items`/`search_work_items`, `fields` must never be pushed down on the
scan path, because projecting away `state_id`/`priority`/`assignee_ids`/
`label_ids` before filtering silently breaks the filter. Those two tools' existing
`fields` handling is unchanged here.

## Design

### `types/config.ts`

`ToolSettings` unchanged. `ServerConfig["defaults"]` gains
`maxOutputTokensCeiling?: number`.

### `src/config.ts`

- `DEFAULT_MAX_OUTPUT_TOKENS_CEILING = 100_000`.
- `serverConfigSchema.defaults` gains `maxOutputTokensCeiling` (positive int).
- `resolveMaxOutputTokens(config, toolName, requestOverride?)` — applies the
  precedence above. Returns `{ limit, source }` so the guidance string can name
  where the active limit came from.
- `resolveCeiling(config)`.

### `src/tools/register.ts`

`toolHandler` gains, before calling `fn`:

```
const override = (args as {max_output_tokens?: number})?.max_output_tokens
if (override !== undefined && override > resolveCeiling(config))
  → isError, names requested value + ceiling + config key. No API call.
```

`buildTokenLimitGuidance(toolName, tokenCount, limit, caps)` where `caps`
describes the tool: `{ fields: bool, perPage: bool, subFilters: bool }`. Emits
only applicable remedies plus:

> Retry with `max_output_tokens: <ceil(tokenCount × 1.1)>` to receive it anyway
> (ceiling: <ceiling>).

…and omits that line when the count already exceeds the ceiling, saying instead
that only `fields` can help.

`TOOL_CAPS: Record<string, Caps>` is the single source of truth, asserted in
tests against the registered schemas so the two cannot drift.

### Per-tool files

Each of the 14 gains `max_output_tokens: z.number().int().positive().optional()`
in its Zod schema; the 10 narrowable ones also gain `fields`/`expand`
(+`cursor`/`per_page` where paginated), destructured out of args and forwarded
through `client.get`'s query object. `max_output_tokens` is stripped before the
query is built — it is a server-side directive, never sent to Plane.

## Tasks

- [ ] `types/config.ts` — `maxOutputTokensCeiling`
- [ ] `src/config.ts` — ceiling default, schema, `resolveMaxOutputTokens` override param, `resolveCeiling`
- [ ] `scripts/generate-config-schema.ts` run → regenerate `plane-mcp.config.schema.json`
- [ ] `src/tools/register.ts` — ceiling pre-check, `TOOL_CAPS`, tool-aware guidance
- [ ] `states.ts`, `labels.ts`, `cycles.ts`, `modules.ts` — `fields`/`expand`/`cursor`/`per_page` + `max_output_tokens`
- [ ] `members.ts` — `fields`/`expand` + `max_output_tokens`
- [ ] `comments.ts`, `relations.ts` — `fields`/`expand`/`cursor`/`per_page` + `max_output_tokens`
- [ ] `work-items.ts`, `projects.ts` — `max_output_tokens` only
- [ ] Tests: precedence, ceiling rejection, guidance-vs-caps drift, passthrough forwarding
- [ ] `README.md` + `CLAUDE.md` routing row + `plane-mcp.config.example.json`
- [ ] TRACK.md decision entry

## Definition of done

- `list_cycles(project_id, fields="id,name")` returns under the limit on the
  project where it previously returned 157k tokens.
- `list_labels` with no `fields` still breaches, and its guidance names `fields`
  and states the ceiling cannot help — because 463k > 100k.
- A `max_output_tokens` above the ceiling is rejected with no API call made.
- Guidance never names a parameter absent from the breaching tool's schema,
  enforced by a test over the live registry.
- `bun run typecheck`, `bun run check`, `bun test` clean.

## Open questions

- `list_work_item_relations` is included in the 14 despite not being in Phase
  19's canonical set of 10 list tools; it is a collection endpoint with no
  narrowing params today and can breach in principle. Flagged in case Phase 19
  wants to align its own list.
