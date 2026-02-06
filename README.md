# project-graph-mcp

**MCP server for AI agents** — provides minified project graph and browser test checklists.

## Features

### 🗺️ Project Graph (124 tokens)
- `get_skeleton` — Compact project overview with class/function counts
- `expand` — Expand minified symbol to full code
- `deps` — Dependency tree for any symbol
- `get_focus_zone` — Auto-enriched context from git diff

### 🧪 Test Checklists
- `get_pending_tests` — List tests from `@test/@expect` JSDoc annotations
- `mark_test_passed` / `mark_test_failed` — Track progress
- `get_test_summary` — Progress report

### 📝 Documentation Analysis
- `get_undocumented` — Find missing JSDoc annotations (levels: tests, params, all)

## Installation

```bash
# Clone
git clone https://github.com/RND-PRO/project-graph-mcp
cd project-graph-mcp

# No npm install needed — zero dependencies
```

## CLI Usage

```bash
# Get project skeleton (minified graph)
node src/server.js skeleton src/components

# Expand minified symbol
node src/server.js expand SN

# Get dependencies
node src/server.js deps SNG

# List pending browser tests
node src/server.js pending src/

# Get test progress summary
node src/server.js summary src/

# Find undocumented code
node src/server.js undocumented src/ --level=tests

# Show help
node src/server.js help
```

### Antigravity Configuration
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

## Test Annotations

Add to your code:
```javascript
/**
 * Toggle pinned state
 * 
 * @test click: Select a node first
 * @test key: Press 'P' key
 * @expect attr: data-pinned attribute appears
 * @expect visual: 📌 pin icon visible
 */
togglePin() { ... }
```

Agent workflow:
```
1. get_pending_tests("src/components")
   → [{ id: "togglePin.0", type: "click", description: "Select a node" }]

2. Agent runs browser test

3. mark_test_passed("togglePin.0")

4. get_test_summary("src/components")
   → { total: 9, passed: 1, pending: 8, progress: 11 }
```

## Architecture

```
project-graph-mcp/
├── src/
│   ├── parser.js           # AST parser (Acorn)
│   ├── graph-builder.js    # Minified graph + analysis
│   ├── test-annotations.js # @test/@expect parsing
│   ├── tools.js            # MCP tool implementations
│   └── server.js           # MCP server (stdio)
├── vendor/
│   ├── acorn.mjs           # AST parser (MIT, vendored)
│   └── walk.mjs            # AST walker (MIT, vendored)
└── tests/
    └── parser.test.js      # Unit tests
```

## Skeleton Example

```json
{
  "L": { "SN": "SymNode", "SNG": "SymNodeGraph" },
  "s": { "files": 23, "classes": 10, "functions": 65 },
  "n": { "SN": { "m": 11, "$": 7 }, "SNG": { "m": 16, "$": 5 } },
  "e": 35, "o": 7, "d": 5, "F": 63
}
```

**L** = Legend, **s** = stats, **n** = nodes, **e** = edges, **o** = orphans, **d** = duplicates, **F** = functions

## License

MIT
