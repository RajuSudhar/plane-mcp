# Security Policy

## Package Security

This project takes security seriously. Before installing any Bun package, we verify it against known compromised packages.

### Compromised Package List

We maintain vigilance against packages listed in known supply chain attacks:

- Source: [DataDog Indicators of Compromise](https://github.com/DataDog/indicators-of-compromise/blob/main/shai-hulud-2.0/consolidated_iocs.csv)
- Reference: [StepSecurity Blog - CTRL, tinycolor and 40+ npm packages compromised](https://www.stepsecurity.io/blog/ctrl-tinycolor-and-40-npm-packages-compromised)

### Before Installing Packages

1. Check the package name against the compromised list
2. Verify the package on npm registry
3. Check the package's GitHub repository
4. Review recent issues and security advisories
5. Run `bun audit` if available, else perform manual security review
6. Check package maintainer reputation and activity

### Reporting Security Issues

If you discover a security vulnerability, please email [your-email] instead of using the issue tracker.

## Dependency Management

- All dependencies are reviewed before addition
- Regular security audits (manual review or `bun audit` when available)
- Automated dependency updates with security review
- Minimal dependency footprint to reduce attack surface
- Exact version pinning in `package.json`

### Security-Reviewed Dependencies

#### gpt-tokenizer@4.0.0

- **Purpose**: Local token counting to enforce per-tool output-token limits (reject-and-guide guard). Avoids the network round-trip and API key requirement of Anthropic's `count_tokens` endpoint.
- **Version**: Exactly pinned to `4.0.0` (no caret/tilde); `bun.lock` committed.
- **License**: MIT
- **Security Profile**:
  - Pure TypeScript/JavaScript
  - Zero runtime dependencies
  - No native addons, no WASM binary
  - No postinstall/lifecycle scripts
  - No network calls, no telemetry
  - Uses o200k_base BPE encoding
- **Accuracy Note**: tiktoken-family encoders undercount Claude tokens by ~15-20%. Code applies a 1.2x safety multiplier for conservative approximation (acceptable for budget guard, not billing).
- **Security Check**: Reviewed against compromised-package list, npm registry, and GitHub source. Actively maintained (release Aug 2026). Clean profile.

## Token Handling

**CRITICAL**: Plane API credentials must be protected at all times.

### Environment Variables

Store credentials ONLY in environment variables:

- `PLANE_API_KEY` - Your Plane API key
- `PLANE_WORKSPACE_SLUG` - Your workspace identifier

### Never Log or Expose Secrets

```typescript
// WRONG - Exposes token in logs
log('debug', 'Using token', { token: process.env.PLANE_API_KEY });

// CORRECT - Redacts sensitive data
log('debug', 'Authenticating with Plane API', { hasToken: !!process.env.PLANE_API_KEY });
```

**Rules**:

- NEVER log `PLANE_API_KEY` or any derived tokens
- NEVER include tokens in error messages
- NEVER transmit tokens to the MCP client
- NEVER commit `.env` files (they are gitignored)

### HTTPS Only

- All Plane API communication MUST use HTTPS
- Validate API URLs to prevent downgrade attacks
- Reject non-HTTPS endpoints

## Input Validation

### API Boundaries

All user inputs received via MCP tools MUST be validated:

```typescript
// Validate workspace slug format
if (!/^[a-z0-9-]+$/i.test(workspaceSlug)) {
  throw new Error('Invalid workspace slug format');
}

// Validate issue ID format
if (!/^[A-Z]+-\d+$/.test(issueId)) {
  throw new Error('Invalid issue ID format');
}
```

### Sanitization

- Escape special characters before API requests
- Type-check all external data
- Validate against expected schemas
- Use Zod for runtime validation

## Common Vulnerabilities

### Avoid These Patterns

1. **Logging Secrets**:

   ```typescript
   // WRONG
   console.error(`API Key: ${apiKey}`);

   // CORRECT
   log('debug', 'API key configured', { hasKey: !!apiKey });
   ```

2. **Exposing Tokens in Errors**:

   ```typescript
   // WRONG
   throw new Error(`Auth failed for token ${token}`);

   // CORRECT
   throw new Error('Authentication failed');
   ```

3. **Stdout Logging** (corrupts MCP protocol):
   ```typescript
   // WRONG - breaks MCP JSON-RPC
   console.log('Processing request...');

   // CORRECT - logs to stderr
   log('debug', 'Processing request');
   ```

## Security Checklist

Before merging any PR:

- [ ] No secrets logged or exposed
- [ ] All API calls use HTTPS
- [ ] Input validation on all tool parameters
- [ ] No new dependencies without security review
- [ ] No `console.log()` calls (use `log()` from logger)
- [ ] `.env` files remain gitignored
- [ ] Exact dependency versions pinned

## Future Enhancements

- Automated dependency scanning in CI
- Secret scanning in commits
- Security audit reports
- Dependency update automation with security checks
