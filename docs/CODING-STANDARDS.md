# Coding Standards

This document defines the coding standards and best practices for the Plane MCP server project.

## TypeScript Standards

### Type vs Interface

**CRITICAL REQUIREMENT**: Always use `type` (NOT `interface`) for all structure definitions.

**Rationale**:

- Consistent codebase style across all files
- Better composition with union and intersection types
- More flexible for future refactoring and type manipulation
- Avoids confusion between `type` and `interface` usage

**Correct Examples**:

```typescript
// CORRECT - Use type for object structures
type Issue = {
  id: string;
  name: string;
  state: string;
};

// CORRECT - Use type for union types
type IssueState = 'backlog' | 'started' | 'completed' | 'cancelled';

// CORRECT - Use type for intersection types
type TimestampedIssue = Issue & {
  created_at: string;
  updated_at: string;
};

// CORRECT - Use type for generic structures
type ApiResponse<T> = {
  data: T;
  status: number;
  timestamp: number;
};

// CORRECT - Use type for function signatures
type LogFunction = (level: string, message: string) => void;
```

**Incorrect Examples**:

```typescript
// INCORRECT - Never use interface
interface Issue {
  // DO NOT USE INTERFACE
  id: string;
  name: string;
}

// INCORRECT - Do not use interface for object structures
interface ApiResponse<T> {
  // DO NOT USE INTERFACE
  data: T;
  status: number;
}
```

**Exception**: Only use `interface` when:

- Extending built-in class types (rare)
- Declaration merging is explicitly required (very rare)

### Type Organization

**Directory Structure**:

All shared types MUST be placed in the `types/` directory at project root:

```text
types/
├── index.ts              # Re-exports all types from subdirectories
├── plane.ts              # Plane API-related types
├── mcp.ts                # MCP protocol-related types
├── config.ts             # Configuration types
├── cache.ts              # Cache-related types
├── logger.ts             # Logging-related types
└── common.ts             # Common/utility types
```

**Type Exports**:

```typescript
// types/index.ts - Central export file
export type * from './plane';
export type * from './mcp';
export type * from './config';
export type * from './cache';
export type * from './logger';
export type * from './common';
```

**Type Imports**:

```typescript
// From src/ directory
import type { PlaneIssue, PlaneProject } from '@types';

// From cli/ directory (future)
import type { PlaneIssue, PlaneProject } from '@types';

// Specific type file import (when needed)
import type { CacheEntry } from '@types/cache';
```

**Rationale for Root-Level types/**:

- Accessible by both `src/` and future `cli/` directories
- Single source of truth for type definitions
- Prevents circular dependencies
- Clear separation of types from implementation

### Type Naming Conventions

**PascalCase for type names**:

```typescript
type Issue = { ... };
type ApiResponse = { ... };
type PlaneIssue = { ... };
```

**Descriptive type names**:

```typescript
// GOOD - Descriptive, clear purpose
type IssueState = 'backlog' | 'started' | 'completed' | 'cancelled';
type CacheEntry<T> = { data: T; timestamp: number; ttl: number };

// BAD - Too generic, unclear
type State = 'backlog' | 'started' | 'completed';
type Entry<T> = { data: T; timestamp: number; ttl: number };
```

## Logging Standards

### Centralized Logger Function

**CRITICAL REQUIREMENT**: All logging MUST use the centralized logger function from `src/logger.ts`.

**NEVER use `console.log()` or `console.info()`** as they write to stdout, which corrupts the MCP JSON-RPC stream.

**Implementation**:

```typescript
// src/logger.ts
import type { LogLevel, LogContext } from '@types/logger';

export function log(level: LogLevel, message: string, context?: LogContext): void {
  // Structured JSON to stderr — stdout reserved for MCP stdio transport
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...(context ? redact(context) : {}),
  };
  process.stderr.write(JSON.stringify(entry) + '\n');
}
```

**Type Definitions**:

```typescript
// types/logger.ts
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogContext = {
  operation?: string;
  toolName?: string;
  endpoint?: string;
  method?: string;
  statusCode?: number;
  error?: string;
  [key: string]: unknown; // Allow additional context fields
};
```

**Usage Examples**:

```typescript
import { log } from './logger';

// Server initialization
log('info', 'MCP server starting', { operation: 'server_init' });

// Tool execution
log('info', 'Executing tool', {
  operation: 'tool_execute',
  toolName: 'plane_get_issue',
  issueId: 'ISSUE-123',
});

// API requests
log('debug', 'Calling Plane API', {
  operation: 'api_request',
  endpoint: '/api/v1/workspaces/example/issues',
  method: 'GET',
});

// API responses
log('debug', 'Plane API response', {
  operation: 'api_response',
  endpoint: '/api/v1/workspaces/example/issues',
  statusCode: 200,
});

// Errors
log('error', 'API request failed', {
  operation: 'api_error',
  endpoint: '/api/v1/workspaces/example/issues',
  error: err.message,
  statusCode: 500,
});

// Cache operations
log('debug', 'Cache hit', {
  operation: 'cache_hit',
  key: 'plane:issues:PROJ-123',
});

log('debug', 'Cache miss', {
  operation: 'cache_miss',
  key: 'plane:issues:PROJ-123',
});
```

### Why No console.log

**CRITICAL**: MCP servers communicate via JSON-RPC over stdio. Writing to stdout with `console.log()` injects non-JSON text into the stream, causing protocol errors and connection failures.

**Allowed**:
- `process.stderr.write()` (used by logger)
- `console.error()` (writes to stderr)

**Forbidden**:
- `console.log()` (writes to stdout)
- `console.info()` (writes to stdout)
- `process.stdout.write()` (except for MCP protocol messages)

### Critical Logging Paths

Logging is REQUIRED at these critical paths:

1. **Server Lifecycle**:
   - Server initialization start/complete
   - Server shutdown start/complete
   - Configuration loading

2. **Tool Execution**:
   - Tool execution start (with tool name and parameters)
   - Tool execution complete (with execution time)
   - Tool execution error

3. **API Interactions**:
   - All Plane API requests (endpoint, method)
   - All Plane API responses (status code, duration)
   - API errors (error message, status code)

4. **Authentication**:
   - Authentication attempts (success/failure)
   - Token validation
   - Permission checks

5. **Cache Operations**:
   - Cache hits (key, data type)
   - Cache misses (key)
   - Cache invalidation (pattern)
   - Cache clearing

6. **Error Handling**:
   - All caught errors with context
   - Rate limit events
   - Retry attempts

7. **Performance Events**:
   - Slow operations (> 1s)
   - Large responses (> 1MB)

## Code Style

### Formatting Standards

**Prettier Configuration**:

- Single quotes for strings
- 2-space indentation
- 100-character line length for code
- Semicolons required
- Trailing commas (ES5 style)

**ESLint Configuration** (if added):

- Import ordering (alphabetical within groups)
- No unused imports
- Separate type imports
- No duplicate imports

### Import Organization

**Import Order**:

1. Node.js built-in modules
2. External packages
3. Internal modules
4. Parent/sibling imports
5. Type imports (separate)

**Example**:

```typescript
// 1. Node.js built-ins
import fs from 'fs';
import path from 'path';

// 2. External packages
import { Server } from '@modelcontextprotocol/sdk/server/index.js';

// 3. Internal modules
import { Cache } from './cache';
import { log } from './logger';

// 4. Parent/sibling imports
import { PlaneClient } from '../plane/client';

// 5. Type imports (always separate and last)
import type { CacheEntry } from '@types/cache';
import type { LogContext } from '@types/logger';
import type { PlaneIssue } from '@types/plane';
```

### Naming Conventions

**Files and Directories**:

- Lowercase with hyphens: `issue-tools.ts`
- Singular for types: `issue.ts`, `project.ts`

**Variables and Functions**:

- camelCase: `getIssueById`, `cacheEntry`
- Descriptive names: `planeClient` not `client`

**Types**:

- PascalCase: `Issue`, `Project`, `ApiResponse`
- Prefix boolean types with `is`, `has`, `should`: `isEnabled`, `hasPermission`

**Constants**:

- UPPER_SNAKE_CASE: `DEFAULT_CACHE_TTL`, `MAX_RETRIES`

### No Emojis

**CRITICAL REQUIREMENT**: No emojis in any code, scripts, or output.

**Incorrect**:

```typescript
console.error('Success!');
console.error('Failed');
```

**Correct**:

```typescript
console.error('SUCCESS: Operation completed');
console.error('ERROR: Operation failed');
```

## Runtime & Tooling Standards

### Bun Only

**CRITICAL REQUIREMENT**: This project uses Bun 1.3.14 exclusively.

- No npm, no pnpm, no yarn, no other package managers
- Pin Bun version via `.bun-version` file (contents: `1.3.14`)
- Dependency lockfile is `bun.lock` (MUST be committed)

**Commands**:

```bash
bun install              # Install dependencies
bun run <script>         # Run package.json script
bun test                 # Run tests
bun run typecheck        # Type-check only (tsc --noEmit)
```

### TypeScript Compilation

**Type-check only** — `tsc --noEmit` is for type checking ONLY.

- `tsconfig.json` has `noEmit: true`
- NEVER emit or commit `.js` files
- Bun runs `.ts` files natively
- TypeScript source only in the repository

**No Build Output**:

- No `dist/` directory (TypeScript source only)
- No `.js`, `.d.ts`, or `.map` files committed
- Bun executes TypeScript directly

### Testing Standards

**Test Framework**: TBD (will be defined in scaffold phase)

**Test File Organization**:

```text
src/
├── cache.ts
├── cache.test.ts           # Unit tests alongside implementation
├── logger.ts
├── logger.test.ts
└── plane/
    ├── client.ts
    └── client.test.ts
```

**Test Naming**:

```typescript
// Describe block: Component/Function name
describe('Cache', () => {
  // Test case: should + behavior
  it('should return null for non-existent key', () => {
    // ...
  });

  it('should cache entry with TTL', () => {
    // ...
  });

  it('should invalidate entries matching pattern', () => {
    // ...
  });
});
```

## Documentation Standards

### Code Comments

**When to Comment**:

- Complex algorithms or business logic
- Non-obvious workarounds or hacks
- Important architectural decisions
- Security-sensitive code

**When NOT to Comment**:

- Self-explanatory code
- Redundant information from code
- Obvious variable/function names

**Example**:

```typescript
// GOOD - Explains non-obvious behavior
// Plane API requires workspace slug in URL path, not query params
const endpoint = `/api/v1/workspaces/${workspaceSlug}/issues/${issueId}`;

// BAD - States the obvious
// Set the issue name
const issueName = issue.name;
```

### Markdown Documentation

All markdown MUST follow markdownlint rules:

- 120-character line length
- ATX-style headers (`##` not underlined)
- Consistent list styles
- Fenced code blocks with language tags

## Security Standards

### Dependency Management

- All packages MUST be verified against compromised package list
- Use exact versions in `package.json`
- Run `bun audit` if available, else manual review
- Review dependency updates before merging
- Minimal dependency footprint to reduce attack surface

### Token Handling

- Store tokens in environment variables ONLY
- NEVER log `PLANE_API_KEY` or include in error messages
- Use HTTPS-only for API communication
- No token transmission to MCP client

### Input Validation

- Validate all user inputs at API boundaries
- Sanitize data before API requests
- Type-check all external data

## Performance Standards

### Caching

- Cache static/rarely-changing data aggressively
- Use configurable TTLs based on data volatility
- Invalidate cache on write operations
- Log cache hit/miss ratios

### API Optimization

- Minimize API calls through batching
- Implement retry logic with exponential backoff
- Respect rate limits with inter-request delays
- Use streaming for large responses (future)

## References

- [TypeScript Handbook](https://www.typescriptlang.org/docs/)
- [Bun Documentation](https://bun.sh/docs)
- [MCP Protocol Specification](https://modelcontextprotocol.io/)
