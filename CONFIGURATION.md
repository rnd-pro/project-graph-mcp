# MCP Client Configuration

Configuration examples for popular MCP clients (2026).

---

## Desktop & IDE Clients

### Antigravity / Gemini CLI
```json
// .gemini/settings.json
{
  "mcpServers": {
    "project-graph": {
      "command": "node",
      "args": ["/path/to/project-graph-mcp/src/server.js"]
    }
  }
}
```

### Cursor
```json
// .cursor/mcp.json
{
  "mcpServers": {
    "project-graph": {
      "command": "node",
      "args": ["/path/to/project-graph-mcp/src/server.js"]
    }
  }
}
```

### Zed
```json
// ~/.config/zed/settings.json
{
  "language_models": {
    "mcp_servers": {
      "project-graph": {
        "command": "node",
        "args": ["/path/to/project-graph-mcp/src/server.js"]
      }
    }
  }
}
```

### VS Code + Copilot
```json
// .vscode/mcp.json
{
  "servers": {
    "project-graph": {
      "command": "node",
      "args": ["/path/to/project-graph-mcp/src/server.js"]
    }
  }
}
```

### Continue
```json
// ~/.continue/config.json
{
  "mcpServers": [
    {
      "name": "project-graph",
      "command": "node",
      "args": ["/path/to/project-graph-mcp/src/server.js"]
    }
  ]
}
```

### Sourcegraph Cody
```json
// ~/.sourcegraph/cody.json
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

---

## AI Assistants

### Claude Desktop
```json
// macOS: ~/Library/Application Support/Claude/claude_desktop_config.json
// Windows: %APPDATA%\Claude\claude_desktop_config.json
{
  "mcpServers": {
    "project-graph": {
      "command": "node",
      "args": ["/path/to/project-graph-mcp/src/server.js"]
    }
  }
}
```

### OpenCode / Crush
```json
// ~/.config/opencode/config.json
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

### CodeGPT (VS Code / JetBrains)
```json
// Extension settings
{
  "codegpt.mcp.servers": {
    "project-graph": {
      "command": "node",
      "args": ["/path/to/project-graph-mcp/src/server.js"]
    }
  }
}
```

---

## Mobile & Cross-Platform

### Jenova (iOS/Android)
Add via app settings → MCP Servers → Custom:
- **Name**: project-graph
- **Command**: node
- **Args**: /path/to/project-graph-mcp/src/server.js

---

## Enterprise & Frameworks

### Firebase Genkit
```javascript
import { mcpClient } from '@genkit-ai/mcp';

const projectGraph = mcpClient({
  command: 'node',
  args: ['/path/to/project-graph-mcp/src/server.js'],
});
```

### NVIDIA AIQ Toolkit
```yaml
# aiq_config.yaml
mcp_servers:
  project-graph:
    command: node
    args:
      - /path/to/project-graph-mcp/src/server.js
```

---

## Any MCP Client

The server uses **stdio transport** — JSON-RPC 2.0 over stdin/stdout.

### Protocol
- **Methods**: `initialize`, `tools/list`, `tools/call`
- **Transport**: stdio (no HTTP server)

### Manual Test
```bash
echo '{"jsonrpc":"2.0","method":"tools/list","id":1}' | node src/server.js
```
