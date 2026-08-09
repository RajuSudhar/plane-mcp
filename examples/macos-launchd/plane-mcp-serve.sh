#!/bin/sh
# Run the plane-mcp HTTP server as a launchd service.
# The API key is resolved from the OS keychain by PLANE_MCP_INSTANCE
# (stored via `plane-mcp init <name>`), so no secret is set here.
set -eu

BUN="${BUN:-$HOME/.bun/bin/bun}"
APP_DIR="${PLANE_MCP_DIR:-$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)}"
export PLANE_MCP_INSTANCE="${PLANE_MCP_INSTANCE:-default}"
export PLANE_WORKSPACE_SLUG="${PLANE_WORKSPACE_SLUG:?set PLANE_WORKSPACE_SLUG}"
export PLANE_BASE_URL="${PLANE_BASE_URL:-https://api.plane.so}"
export PORT="${PORT:-3444}"

cd "$APP_DIR"
exec "$BUN" run start
