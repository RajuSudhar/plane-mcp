# macOS launchd Persistence (Optional)

This example demonstrates how to run `plane-mcp` as a persistent background service on macOS using launchd. This is **entirely optional** — for most users, the recommended setup is `plane-mcp init` followed by installing `plane-mcp` as a command-launched MCP server in your client config.

## Prerequisites

Before proceeding, you must have stored an API key via `plane-mcp init`:

```bash
plane-mcp init <name> --workspace <workspace-slug>
```

This stores the key in your OS keychain, keyed by the instance name. See the main `README.md` for details.

## Setup

Export your workspace slug (required), and optionally the instance name, base URL, and port, then run the install script:

```bash
export PLANE_WORKSPACE_SLUG=<workspace-slug>   # Required
export PLANE_MCP_INSTANCE=<name>               # Optional; defaults to 'default'
export PLANE_BASE_URL=https://api.plane.so     # Optional; defaults shown
export PORT=3000                                # Optional; defaults shown
sh install-launchd.sh
```

This:

1. Fills in the launchd plist template with absolute paths.
2. Installs the LaunchAgent to `~/Library/LaunchAgents/com.plane-mcp.server.plist`.
3. Starts the service immediately.

The server now runs in the background and will restart automatically after logout/login or if it crashes.

## Verify

Check that the server is running:

```bash
curl -s http://127.0.0.1:3000/health
```

If running, you'll see `{"status":"ok"}`. Logs are available at:

```bash
tail -f ~/Library/Logs/plane-mcp.out.log
tail -f ~/Library/Logs/plane-mcp.err.log
```

## Configure an MCP Client

Register the HTTP server with your MCP client:

```bash
claude mcp add --transport http --scope user plane-<name> http://127.0.0.1:3000/mcp
```

Or add manually to your client config (e.g., Claude Desktop):

```json
{
  "mcpServers": {
    "plane-<name>": {
      "url": "http://127.0.0.1:3000/mcp",
      "type": "http"
    }
  }
}
```

## Uninstall

To stop and remove the LaunchAgent:

```bash
sh uninstall-launchd.sh
```

## Caveats

- **Login agents only**: LaunchAgents load at login time, not at boot time (pre-login). For pre-login startup, use LaunchDaemon (out of scope).
- **Missing key crash-loop**: If the keychain entry (stored by `plane-mcp init <name>`) is missing or inaccessible, the wrapper will exit non-zero. launchd's `KeepAlive` will restart it every ~10 seconds — check `~/Library/Logs/plane-mcp.err.log` and run `plane-mcp init <name>` again to fix.
- **First-read prompt**: The first time launchd reads from the keychain, macOS may prompt you to authorize `security`. Click "Always Allow" to prevent future prompts.
- **Multi-instance**: You can run multiple LaunchAgents (one per `PLANE_MCP_INSTANCE`) by repeating the setup with different instance names. Each plist will have a unique Label (or you can customize it).
