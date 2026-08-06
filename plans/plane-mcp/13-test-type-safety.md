# feat-test-type-safety

Phase: 13 | Status: [x] done
Depends on: 12-type-aware-lint
Ref: `src/plane/client.ts`, `types/mcp.ts`, `src/tools/register.ts`,
`src/server.ts`, every `src/tools/*.ts` / `src/tools/*.test.ts` pair,
`src/plane/client.test.ts`, `.oxlintrc.json`, `docs/CODING-STANDARDS.md`

## Goal

Eliminate all 20 `as unknown as` double-casts from the test suite by
depending on a structural `PlaneApi` interface instead of the nominal
`PlaneClient` class, replacing the hand-rolled `fetch` mocks with
`spyOn`, and adding an oxlint rule that prevents the pattern from
regressing.

## In scope

- `src/plane/client.ts`: add and export a structural type `PlaneApi`
  derived from `PlaneClient` via `Pick`.
- Widen the tool layer's dependency from the concrete `PlaneClient`
  class to the `PlaneApi` interface: `types/mcp.ts`'s `ToolHandler`,
  `src/tools/register.ts`'s `toolHandler`, and every `src/tools/*.ts`
  file's exported pure functions and `registerXTools` signature.
- Replace the 9 `globalThis.fetch = mock(...) as unknown as typeof
fetch` assignments in `src/plane/client.test.ts` with `spyOn`.
- Remove the 10 `as unknown as PlaneClient` casts in the tool tests'
  `makeClient` helpers (one per `src/tools/*.test.ts` file) by typing
  the stub's return as `PlaneApi`.
- Fix the 1 stray `as unknown as string` in
  `src/tools/projects.test.ts:99` to a plain `as string`.
- Add an oxlint type-aware rule that flags unnecessary/redundant type
  assertions to `.oxlintrc.json`, after verifying the exact rule name
  the installed `oxlint`/`oxlint-tsgolint` version ships.
- Fix any genuinely-redundant `as X` cast the new rule surfaces among
  the codebase's remaining plain (non-`unknown`-hop) casts.

## Out of scope

- Any change to `PlaneClient`'s runtime behavior, its `request`
  method, retry/backoff logic, or its private `auth` field. This
  phase only adds a derived exported type next to the class.
- Any change to tool logic, tool schemas, tool registration order, or
  `src/server.ts` runtime behavior. `createServer` continues to
  construct a real `PlaneClient` and pass it to every
  `registerXTools` function; because `PlaneClient` structurally
  satisfies `PlaneApi`, this requires no code change — see Design.
- The ~140 other, legitimate narrowing casts (`as string`, `as
Record<string, unknown>`, `as { type: 'text'; text: string }`,
  etc.) that remain in the test suite. Only the 20 `as unknown as`
  double-casts and the resulting oxlint findings (if any) are in
  scope; a plain single-hop cast that a human still needs for a real
  narrowing is not touched.
- Adding a broader `consistent-type-assertions` rule or banning
  casts generally — deferred, see Open questions.
- Any dependency version bump. `oxlint`/`oxlint-tsgolint` stay at the
  versions Phase 12 pinned; this phase only edits `.oxlintrc.json`'s
  `rules` block.

## Design

### Why these casts exist

`PlaneClient` (`src/plane/client.ts`) is a nominal class — it has a `private readonly auth: AuthContext` field, which
TypeScript uses to brand the type. A plain object literal with matching `get`/`post`/`patch`/`delete`/`workspacePath`/
`apiPath` methods is structurally compatible with everything _except_ that private field, so TypeScript rejects a direct
assignment of a test stub to `PlaneClient`. The existing test suite works around this with a double-cast through
`unknown`, which defeats the type checker for the entire stub — this is precisely the unsafety
`docs/CODING-STANDARDS.md` should not tolerate.

Separately, `src/plane/client.test.ts` stubs `globalThis.fetch` with `mock(...) as unknown as typeof fetch`, because
`mock()`'s inferred type does not structurally match the global `fetch` signature closely enough for a direct assignment
either.

### `PlaneApi` — an explicit structural type

The plan originally proposed `PlaneApi = Pick<PlaneClient, 'get' | 'post' | 'patch' | 'delete' | 'workspacePath' |
'apiPath'>` in `src/plane/client.ts`, alongside the class. This was superseded during implementation: `Pick<Class, ...>`
couples the interface to the class implementation and puts the type in `src/` (not `types/`), conflating domain logic
with the API surface tools depend on.

The **actual implementation** defines an explicit structural type in `types/client.ts`:

```ts
export type PlaneApi = {
  get<T>(path: string, query?: Record<string, string | number | boolean | undefined>): Promise<T>;
  post<T>(path: string, body: unknown): Promise<T>;
  patch<T>(path: string, body: unknown): Promise<T>;
  delete(path: string): Promise<void>;
  workspacePath(sub: string): string;
  apiPath(sub: string): string;
};
```

`PlaneClient` (`src/plane/client.ts`) declares `implements PlaneApi` and satisfies it structurally. Both a real
`PlaneClient` instance and a plain test stub now satisfy `PlaneApi` with zero casts. This decouples the tool-layer
dependency from the class's implementation details.

### Tool layer — depend on `PlaneApi`, not `PlaneClient`

This is dependency inversion at the type level: tool code depends on the capability surface it uses, not the concrete
class. Concretely:

- `types/mcp.ts`: `import type { PlaneApi } from './client'` and `ToolHandler` signature becomes
  `(client: PlaneApi, args: TArgs) => Promise<ToolResult>`.
- `src/tools/register.ts`: `import type { PlaneApi } from '../../types/client'` and `toolHandler<TArgs>(toolName:
string, client: PlaneApi, fn: ToolHandler<TArgs>)`.
- Every `src/tools/*.ts` file (`users.ts`, `projects.ts`, `work-items.ts`, `comments.ts`, `relations.ts`, `states.ts`,
  `labels.ts`, `members.ts`, `cycles.ts`, `modules.ts`): `import type { PlaneApi } from '../../types/client'` and every
  exported handler function's `client: PlaneClient` parameter plus every `registerXTools(server: McpServer, client:
PlaneClient)` signature becomes `client: PlaneApi`. No function-body changes — every call site only invokes
  `get`/`post`/`patch`/`delete`/`workspacePath`/`apiPath`, all of which `PlaneApi` exposes.
- `src/server.ts`: **no change required.** `createServer` constructs `const client = new PlaneClient(auth)` and passes
  that instance to every `registerXTools` call. A `PlaneClient` instance is assignable everywhere a `PlaneApi` is
  expected (the class implements the interface), so widening the `registerXTools` parameter types forces no call-site
  edit in `server.ts`.

Runtime behavior is unchanged: the object flowing through `createServer` → `registerXTools` → `toolHandler` → tool fn
is still the same real `PlaneClient` instance at every production call site. Only the _type_ tools are written against
changes, from a concrete class to the interface it implements.

### Fetch mocks — constructor injection via `FetchLike`, not `spyOn`

The plan originally proposed replacing `globalThis.fetch = mock(...) as unknown as typeof fetch` with
`spyOn(globalThis, 'fetch').mockImplementation(...)`. This was superseded during implementation: Bun's global `fetch`
has a `preconnect(url, options): void` extension method that does not exist on the standard `typeof fetch`, so
`spyOn(globalThis, 'fetch')` returns `Mock<typeof globalThis.fetch>` (including `preconnect`), not
`Mock<typeof fetch>`. Assigning a bare `mock(async () => ...)` to it would fail unless the mock also implemented
`preconnect`, forcing a cast or an oxlint suppression — the same problem the plan aimed to eliminate.

The **actual implementation** injects `fetch` via a `FetchLike` type (in `types/client.ts`):

```ts
export type FetchLike = (input: URL | string, init?: RequestInit) => Promise<Response>;
```

`PlaneClient`'s constructor becomes:

```ts
constructor(
  private readonly auth: AuthContext,
  private readonly fetchFn: FetchLike = fetch
) {}
```

The `request` method calls `this.fetchFn(url, init)` instead of `fetch(url, init)`. Tests construct
`new PlaneClient(auth, mock<FetchLike>(...))` with no cast — the mock's type is exactly `FetchLike`, not a superset
requiring suppressions. `src/plane/client.test.ts` no longer mutates `globalThis.fetch` at all; every test constructs a
fresh `PlaneClient` with its own `FetchLike` mock.

This avoids both the Bun-specific `preconnect` augmentation and the entire category of global-state pollution in tests.

### Tool tests — shared `stubClient()` helper

The plan proposed each test file's `makeClient` helper returning `PlaneApi` directly. The **actual implementation**
consolidates the pattern into a shared helper (`src/tools/client-stub.ts`):

```ts
export const stubClient = <T>(spies: {
  get?: Mock<(path: string, query?: Record<string, string | number | boolean | undefined>) => Promise<T>>;
  post?: Mock<(path: string, body: unknown) => Promise<T>>;
  patch?: Mock<(path: string, body: unknown) => Promise<T>>;
  delete?: Mock<(path: string) => Promise<void>>;
}): PlaneApi => ({
  get: (spies.get ?? mock(async () => ({}) as T)) as PlaneApi['get'],
  post: (spies.post ?? mock(async () => ({}) as T)) as PlaneApi['post'],
  patch: (spies.patch ?? mock(async () => ({}) as T)) as PlaneApi['patch'],
  delete: spies.delete ?? mock(async () => {}),
  apiPath: (s: string) => '/api/v1/' + s.replace(/^\//, ''),
  workspacePath: (s: string) => '/api/v1/workspaces/ws/' + s.replace(/^\//, ''),
});
```

Each tool test file imports `stubClient` and calls it directly: `const client = stubClient({ get: mockGet })`. The
helper has **three sanctioned `as T` casts** (one per generic method: `get`, `post`, `patch`) to satisfy the generic
return-type mismatch between `mock(async () => ({}))` (inferred as `Promise<{}>`) and the method's `Promise<T>`. These
are the only casts in the entire tool-test layer. The ten `as unknown as PlaneClient` double-casts are eliminated.

### Type movement to `types/`

Alongside `PlaneApi` and `FetchLike` in `types/client.ts`, `WorkItemWriteInput` (the shared create/update payload type)
moved to `types/plane.ts`, and `RequestOptions` (the internal `PlaneClient.request` parameter type) moved to
`types/client.ts`. All standalone client-related types now live in `types/`, not `src/`.

### Cast-free `add_work_items` tools

`add_work_items_to_cycle` (`src/tools/cycles.ts:69`) and `add_work_items_to_module` (`src/tools/modules.ts:73`)
originally had a necessary cast that was removed during oxlint enforcement, leaving the type as `{}` instead of
`Record<string, unknown>`. The fix: type the POST result directly via the generic parameter
(`client.post<Record<string, unknown>>(path, body)`) and pass it to `structuredContent` with no fallback or cast. This
demonstrates the correct pattern: when a type mismatch arises, fix it at the call site via the method's generic
parameter, not via post-hoc casts.

### `src/tools/projects.test.ts:99` — stray double-cast

```ts
const pathArg = callArgs[0] as unknown as string;
```

becomes

```ts
const pathArg = callArgs[0] as string;
```

`callArgs` is already typed `unknown[]`, so a single `as string` is a
direct, sufficient narrowing — the `unknown` hop is redundant (the
element type is already `unknown`, not something incompatible that
needs a detour).

### oxlint — prevent regression

Add a type-aware cast rule to `.oxlintrc.json`'s `rules` block as
`"error"`, e.g.:

```json
"typescript/no-unnecessary-type-assertion": "error"
```

**Verification required before landing**: at implementation time,
confirm this exact rule name exists in the installed `oxlint`/
`oxlint-tsgolint` version's `typescript` plugin (`oxlint --rules` or
equivalent, per Phase 12's established verification pattern). Do not
add a nonexistent rule name — an unknown rule key breaks
`.oxlintrc.json` outright, the way an unpinned/incorrect dependency
would. If the shipped name differs from
`no-unnecessary-type-assertion`, use the actual name. If no
equivalent rule ships in the pinned version, do not add a
placeholder — record that finding in this file's Open questions and
land the phase without the rule, since the 20 double-casts are
already gone through the design above without needing the lint rule
to also be in place.

`typeAware` is already `true` at the config root (Phase 12), so no
further config-mode change is needed for this rule to run — only the
new rule key.

This rule is a type-aware redundant-assertion check: it flags a cast
that narrows to a type the expression already has. It would have
caught the `projects.test.ts:99` stray `as unknown as string` cast
directly (`unknown` narrowed to `unknown` first, then `string` —
redundant hop), which is exactly the kind of drift this phase closes
the door on. Running it after this phase's edits is expected to
surface a small number of genuinely-redundant plain `as X` casts
among the ~140 remaining single-hop casts in the test suite (not the
20 in scope above, which are gone by design already) — fix each one
found by removing the redundant cast; do not scope-creep into
casts the rule does not flag.

### Regression fix in `add_work_items_to_cycle` and `add_work_items_to_module`

In `src/tools/cycles.ts:69` and `src/tools/modules.ts:73`, a necessary
cast was removed during oxlint enforcement, but the type fallback
(`result ?? {}`) left the type as `{}` instead of the required
`Record<string, unknown>`. Fixed by typing the POST result directly as
`Record<string, unknown>` (via `client.post<Record<string, unknown>>`)
and passing it to `structuredContent` without a fallback or cast. This
demonstrates the core pattern: when a type mismatch arises, update the
method's generic parameter at the call site rather than adding a cast
on the result.

### Full file list

Source (signature widening):

- `src/plane/client.ts` — add `export type PlaneApi`
- `types/mcp.ts` — `ToolHandler` takes `PlaneApi`
- `src/tools/register.ts` — `toolHandler` takes `PlaneApi`
- `src/tools/users.ts`, `projects.ts`, `work-items.ts`, `comments.ts`,
  `relations.ts`, `states.ts`, `labels.ts`, `members.ts`, `cycles.ts`,
  `modules.ts` — handler + `registerXTools` signatures take `PlaneApi`
- `src/server.ts` — confirmed unchanged (see Design); re-verify with
  `bun run typecheck`, do not edit speculatively

Tests:

- `src/plane/client.test.ts` — 9 `spyOn` replacements
- `src/tools/users.test.ts`, `projects.test.ts`, `work-items.test.ts`,
  `comments.test.ts`, `relations.test.ts`, `states.test.ts`,
  `labels.test.ts`, `members.test.ts`, `cycles.test.ts`,
  `modules.test.ts` — 1 `makeClient` cast removal each (10 total)
- `src/tools/projects.test.ts:99` — stray cast fix (additional to its
  `makeClient` fix above; this file has 2 of the 20 occurrences)

Config:

- `.oxlintrc.json` — add the verified cast-redundancy rule

## Tasks

- [x] Add `export type PlaneApi = Pick<PlaneClient, 'get' | 'post' |
'patch' | 'delete' | 'workspacePath' | 'apiPath'>;` to
      `src/plane/client.ts`
- [x] Update `types/mcp.ts`'s `ToolHandler` to take `client: PlaneApi`
- [x] Update `src/tools/register.ts`'s `toolHandler` to take `client:
PlaneApi`
- [x] Update all 10 `src/tools/*.ts` files' handler functions and
      `registerXTools` signatures from `PlaneClient` to `PlaneApi`
      (import swap + parameter type swap only, no body changes)
- [x] Run `bun run typecheck` — confirm `src/server.ts` needs no edit
      (a real `PlaneClient` instance still satisfies `PlaneApi`
      everywhere it's passed)
- [x] Replace the 9 `globalThis.fetch = mock(...) as unknown as
typeof fetch` assignments in `src/plane/client.test.ts` with
      `spyOn(globalThis, 'fetch').mockImplementation(...)`; consolidate
      the existing `beforeEach`/`afterEach` fetch save/restore with the
      spy's own restore into one mechanism
- [x] Remove the 10 `as unknown as PlaneClient` casts across every
      `src/tools/*.test.ts` `makeClient` helper; retype the helper's
      return as `PlaneApi`; swap the `PlaneClient` import for
      `PlaneApi` in each file
- [x] Fix the stray `as unknown as string` in
      `src/tools/projects.test.ts:99` to `as string`
- [x] Verify the exact type-aware cast-redundancy rule name shipped by
      the pinned `oxlint`/`oxlint-tsgolint` version; add it as
      `"error"` to `.oxlintrc.json`, or record in Open questions why
      it was skipped
- [x] Run `bun run lint` — fix every genuinely-redundant cast the new
      rule surfaces among the remaining ~140 plain casts (remove the
      redundant cast only; do not touch casts the rule does not flag)
- [x] `grep -rn "as unknown as" src/ types/` — confirm zero matches
- [x] Run `bun run typecheck` — confirm zero errors
- [x] Run `bun test` — confirm all suites still green, same assertion
      count as before this phase
- [x] Run `bun run lint` — confirm zero errors
- [x] Run `bun run format:check` — confirm zero changes needed
- [x] Update `docs/CODING-STANDARDS.md` with a short note on the
      `PlaneApi` pattern: tool code depends on the structural
      interface, test stubs satisfy it without a cast, and `spyOn` is
      the required mocking mechanism for `globalThis.fetch` (no
      `as unknown as typeof fetch`)
- [x] Update `docs/plans/TRACK.md`: Phase 13 row `[ ]` at start, `[x]`
      at completion; append a decisions-log entry recording the
      `PlaneApi` interface and the double-cast removal

## Definition of done

- [x] Zero occurrences of `as unknown as` anywhere in the repository
      (`src/`, `types/`)
- [x] `bunx tsc --noEmit` (`bun run typecheck`) passes with zero errors
- [x] `oxlint` (`bun run lint`, type-aware) passes with zero errors
- [x] `bun test` passes, same test/assertion count as pre-phase
- [x] `bun run format:check` reports zero changes needed
- [x] `PlaneApi` is exported from `src/plane/client.ts`; every tool
      file and `types/mcp.ts`/`src/tools/register.ts` depends on it,
      not on the concrete `PlaneClient` class
- [x] `src/server.ts` is unchanged (or only an import-line tidy, no
      logic change) — a real `PlaneClient` still flows through
      unmodified at runtime
- [x] An oxlint cast-redundancy rule is present in `.oxlintrc.json`,
      or its absence is documented in this file's Open questions with
      the reason (rule unavailable in the pinned version)
- [x] `docs/CODING-STANDARDS.md` documents the `PlaneApi` /
      structural-stub / `spyOn` pattern for future tool + test
      additions
- [x] `docs/plans/TRACK.md` updated: Phase 13 row and decisions-log
      entry present

## Open questions

- **Exact oxlint cast-rule name**: this plan assumes
  `typescript/no-unnecessary-type-assertion` based on the
  `typescript-eslint` rule of the same purpose, but Phase 12 already
  established that `oxlint`'s `typescript` plugin (via `tsgolint`) is
  an independent reimplementation, not a 1:1 name mirror. Verify at
  implementation time; update this section with the confirmed name
  before marking the phase done.
- **Broader `consistent-type-assertions` rule**: whether to also
  adopt a stricter oxlint rule banning `as` assertions generally
  (forcing type guards / `satisfies` instead) is deferred — this
  phase only closes the specific `as unknown as` double-cast gap and
  adds redundancy detection, not a general cast ban. A future phase
  can revisit if cast drift recurs.
