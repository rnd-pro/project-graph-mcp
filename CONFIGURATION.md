# MCP Client Configuration

Configuration examples for different MCP clients.

## Antigravity / Gemini CLI

Add to `.gemini/settings.json`:
```json
{
  "mcpServers": {
    "project-graph": {
      "command": "node",
      "args": ["/path/to/project-graph-mcp/src/server.js"]
    }
  }
}
```

## Cursor

Add to `.cursor/mcp.json`:
```json
{
  "mcpServers": {
    "project-graph": {
      "command": "node",
      "args": ["/path/to/project-graph-mcp/src/server.js"]
    }
  }
}
```

## Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS):
```json
{
  "mcpServers": {
    "project-graph": {
      "command": "node",
      "args": ["/path/to/project-graph-mcp/src/server.js"]
    }
  }
}
```

## OpenCode / Crush

Add to `~/.config/opencode/config.json`:
```json
{
  "mcp": {
    "servers": {
      "project-graph": {
        "command": "node",
        "args": ["/path/to/project-graph-mcp/src/server.js"]
      }
    }
  }
}
```

## VS Code + Copilot

Add to `.vscode/mcp.json`:
```json
{
  "servers": {
    "project-graph": {
      "command": "node",
      "args": ["/path/to/project-graph-mcp/src/server.js"]
    }
  }
}
```

## Any MCP Client

The server uses **stdio transport** — pass JSON-RPC messages via stdin/stdout.

### Protocol
- **JSON-RPC 2.0** over stdio
- **Methods**: `initialize`, `tools/list`, `tools/call`

### Manual Test
```bash
echo '{"jsonrpc":"2.0","method":"tools/list","id":1}' | node src/server.js
```
