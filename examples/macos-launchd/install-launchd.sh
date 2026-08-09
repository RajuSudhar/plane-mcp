#!/bin/sh
set -eu

HERE="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
SERVE="$HERE/plane-mcp-serve.sh"
PLIST_SRC="$HERE/com.plane-mcp.server.plist"
PLIST_DST="$HOME/Library/LaunchAgents/com.plane-mcp.server.plist"
LABEL="com.plane-mcp.server"

chmod +x "$SERVE"
mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"

esc() { printf '%s' "$1" | sed 's/[&\\]/\\&/g'; }

INSTANCE="${PLANE_MCP_INSTANCE:-default}"
WORKSPACE="${PLANE_WORKSPACE_SLUG:?set PLANE_WORKSPACE_SLUG before installing}"
BASE_URL="${PLANE_BASE_URL:-https://api.plane.so}"
PORT="${PORT:-3444}"

SERVE_ESC=$(esc "$SERVE")
HOME_ESC=$(esc "$HOME")
INSTANCE_ESC=$(esc "$INSTANCE")
WORKSPACE_ESC=$(esc "$WORKSPACE")
BASE_URL_ESC=$(esc "$BASE_URL")
PORT_ESC=$(esc "$PORT")

sed -e "s#__SERVE_SH__#$SERVE_ESC#g" \
    -e "s#__HOME__#$HOME_ESC#g" \
    -e "s#__INSTANCE__#$INSTANCE_ESC#g" \
    -e "s#__WORKSPACE__#$WORKSPACE_ESC#g" \
    -e "s#__BASE_URL__#$BASE_URL_ESC#g" \
    -e "s#__PORT__#$PORT_ESC#g" \
    "$PLIST_SRC" > "$PLIST_DST"

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST_DST"
launchctl kickstart -k "gui/$(id -u)/$LABEL"
echo "Loaded $LABEL. Verify: curl -s http://127.0.0.1:${PORT:-3444}/health"
