# Branch Management System

This document describes the branch management system for this repository, including branch naming conventions and validation rules.

## Overview

The branch management system provides:

- **Validated branch names** following industry best practices
- **Consistent naming** across all contributors
- **Optional ticket ID support** for issue tracking integration

## Branch Naming Convention

### Format

Branches must follow one of these formats:

- `<type>/<description>` - Simple descriptive name
- `<type>/<TICKET-ID>-<description>` - With ticket/issue ID

### Valid Branch Types

| Type       | Description                  | Example                           |
| ---------- | ---------------------------- | --------------------------------- |
| `feature`  | New features                 | `feature/add-issue-creation`      |
| `release`  | Release preparation          | `release/v1.0.0`                  |
| `fix`      | Bug fixes                    | `fix/memory-leak-in-cache`        |
| `doc`      | Documentation changes        | `doc/update-api-guide`            |
| `test`     | Test additions/modifications | `test/add-integration-tests`      |
| `chore`    | Maintenance tasks            | `chore/update-dependencies`       |
| `refactor` | Code refactoring             | `refactor/extract-api-client`     |
| `hotfix`   | Urgent production fixes      | `hotfix/security-patch`           |

### Removed Types

The following type aliases are **not allowed** and will be rejected with helpful error messages:

- `feat` → use `feature`
- `bugfix` → use `fix`
- `perf` → use `refactor` or `feature`

### Examples

**Good branch names:**

- `feature/PLANE-123-add-comment-support`
- `fix/PROJ-456-memory-leak-in-cache`
- `doc/update-api-documentation`
- `refactor/extract-http-client`
- `hotfix/URGENT-789-security-patch`

**Bad branch names (will be rejected):**

- `feat/new-feature` - Use `feature` instead
- `fix/update` - Too vague, needs specific description
- `feature/change` - Too vague
- `bugfix/login-bug` - Use `fix` instead

## Validation Rules

### Format Validation

1. **Type validation** - Only 8 allowed types
2. **Format validation** - Proper `<type>/<description>` structure
3. **Vague term detection** - Rejects generic descriptions without context
4. **Minimum word count** - Descriptions must have sufficient detail
5. **Case validation** - Descriptions must be lowercase with hyphens (kebab-case)

### Protected Branches

These branches bypass validation:

- `main`
- `master`
- `develop`
- `development`

## Industry Best Practices

This system enforces branch naming conventions based on industry best practices:

1. **Semantic Types** - Clear categorization of work type
2. **Ticket Traceability** - Optional issue tracking integration
3. **Descriptive Names** - Meaningful descriptions that explain WHAT, not just generic verbs
4. **Consistency** - Standardized format across team
5. **Automation** - Validation prevents mistakes before they reach remote

## Troubleshooting

### Common Issues

#### Error: "Invalid branch name format"

- Ensure you're using one of the 8 allowed types
- Check that description is lowercase with hyphens
- Avoid vague terms without specific context

#### Error: "Use 'feature' instead of 'feat'"

- The alias `feat` is not allowed, use the full word `feature`
- Same applies to `bugfix` (use `fix`) and `docs` (use `doc`)

#### Renaming a branch

```bash
git branch -m <old-name> <new-name>
```

## References

- [Conventional Commits](https://www.conventionalcommits.org/) - Similar convention for commit messages
- [Git Flow](https://nvie.com/posts/a-successful-git-branching-model/) - Branch management workflow
- [GitHub Flow](https://guides.github.com/introduction/flow/) - Simplified branching strategy
