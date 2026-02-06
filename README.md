# project-graph-mcp

**MCP server for AI agents** — provides minified project graph and universal test checklists.

## Features

### 🗺️ Project Graph (10-50x compression)
- `get_skeleton` — Compact project overview with class/function counts
- `expand` — Expand minified symbol to full code
- `deps` — Dependency tree for any symbol
- `usages` — Find all usages of a symbol
- `get_focus_zone` — Auto-enriched context from git diff

### 🧪 Test Checklists (Universal)
- `get_pending_tests` — List tests from `@test/@expect` JSDoc annotations
- `mark_test_passed` / `mark_test_failed` — Track progress
- `get_test_summary` — Progress report

Supports: Browser, API, CLI, and Integration tests.

### 🔍 Code Quality Analysis
- `get_dead_code` — Find unused functions/classes (never called, not exported)
- `generate_jsdoc` — Auto-generate JSDoc templates with @test/@expect
- `get_similar_functions` — Detect duplicates (signature + structure similarity)
- `get_complexity` — Cyclomatic complexity metrics (flags >10)
- `get_large_files` — Files needing split (lines, functions, exports)
- `get_outdated_patterns` — Legacy code patterns + redundant npm deps (Node 18+ built-ins)
- `get_undocumented` — Find missing JSDoc (@test, @param, @returns)

### ⚙️ Filter Configuration
- `get_filters` / `set_filters` — Configure excluded directories and patterns
- `add_excludes` / `remove_excludes` — Modify exclude list
- Automatic `.gitignore` parsing

### 📘 Agent Instructions
- `get_agent_instructions` — Get coding guidelines, JSDoc format, architecture standards

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

# List pending tests
node src/server.js pending src/

# Get test progress summary
node src/server.js summary src/

# Show filter configuration
node src/server.js filters

# Show agent instructions
node src/server.js instructions

# Code Quality Analysis
node src/server.js deadcode src/       # Find unused code
node src/server.js jsdoc src/file.js   # Generate JSDoc
node src/server.js similar src/        # Find duplicates
node src/server.js complexity src/     # Cyclomatic complexity
node src/server.js largefiles src/     # Large files
node src/server.js outdated .          # Legacy patterns

# Show help
node src/server.js help
```

## MCP Configuration

See **[CONFIGURATION.md](CONFIGURATION.md)** for client-specific setup:
- Antigravity / Gemini CLI
- Cursor / Zed / Continue
- VS Code + Copilot / CodeGPT
- Claude Desktop
- OpenCode / Crush
- Jenova (mobile)
- Firebase Genkit / NVIDIA AIQ

## Test Annotations

Add to your code:
```javascript
/**
 * Create new user via API
 * 
 * @test request: POST /api/users with valid data
 * @expect status: 201 Created
 * @expect db: User row created
 */
async createUser(data) { ... }
```

Supported types:
- **Browser**: click, key, drag, type, scroll, hover
- **API**: request, call, invoke, mock
- **CLI**: run, exec, spawn, input
- **Integration**: setup, action, teardown, wait

Agent workflow:
```
1. get_pending_tests("src/")
   → [{ id: "createUser.0", type: "request", description: "POST /api/users" }]

2. Agent runs the test

3. mark_test_passed("createUser.0")

4. get_test_summary("src/")
   → { total: 9, passed: 1, pending: 8, progress: 11 }
```

## Architecture

```
project-graph-mcp/
├── src/
│   ├── server.js           # Entry point (CLI/MCP mode switch)
│   ├── mcp-server.js       # MCP server logic (stdio)
│   ├── cli.js              # CLI command handling
│   ├── tool-defs.js        # MCP tool definitions
│   ├── tools.js            # Tool implementations
│   ├── parser.js           # AST parser (Acorn)
│   ├── graph-builder.js    # Minified graph + analysis
│   ├── test-annotations.js # @test/@expect parsing
│   ├── filters.js          # Exclude patterns, .gitignore
│   └── instructions.js     # Agent guidelines
├── vendor/
│   ├── acorn.mjs           # AST parser (MIT, vendored)
│   └── walk.mjs            # AST walker (MIT, vendored)
└── tests/
    ├── parser.test.js      # Parser tests
    └── mcp.test.js         # Server tests
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
