#!/bin/sh
set -eu

LABEL="com.plane-mcp.server"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/$LABEL.plist"
echo "Unloaded and removed $LABEL."
