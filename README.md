# project-graph-mcp

**MCP server for AI agents** — multi-language project graph, code quality analysis, and framework-specific lint rules.

> Developed by [RND-PRO](https://rnd-pro.com)

## Why?

AI agents struggle with large codebases:
- **Context limits** — can't read entire project at once
- **No architecture awareness** — miss patterns and conventions
- **Framework blindness** — don't know React vs Vue vs Symbiote best practices
- **Manual verification** — no structured way to track what's tested

**Project Graph MCP solves this:**
- 📦 **10-50x compression** — skeleton view fits in context window
- 🌐 **Multi-language** — JavaScript, TypeScript, Python, Go
- 🔍 **Code quality analysis** — dead code, complexity, duplicates
- 🎯 **Framework-specific rules** — auto-detect and apply (React, Vue, Express, Node.js, Symbiote)
- ✅ **Test checklists** — track @test/@expect annotations

## Features

### 🗺️ Project Graph (10-50x compression)
- `get_skeleton` — Compact project overview with class/function counts
- `expand` — Expand minified symbol to full code
- `deps` — Dependency tree for any symbol
- `usages` — Find all usages of a symbol
- `get_focus_zone` — Auto-enriched context from git diff
- `get_call_chain` — BFS call path analysis between symbols

**Supported languages:** JavaScript (AST via Acorn), TypeScript/TSX, Python, Go — all with unified ParseResult API.

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
- `get_full_analysis` — Run ALL checks + Health Score (0-100)

### 🔧 Custom Rules (Configurable)
- `get_custom_rules` — List all rulesets and rules
- `set_custom_rule` — Add/update a rule (agent can configure)
- `check_custom_rules` — Run custom rules analysis

Includes 10 pre-built rulesets (62 rules): React 18/19, Vue 3, Next.js 15, Express 5, Fastify 5, NestJS 10, TypeScript 5, Node.js 22, Symbiote 2.x

### ⚙️ Filter Configuration
- `get_filters` / `set_filters` — Configure excluded directories and patterns
- `add_excludes` / `remove_excludes` — Modify exclude list
- Automatic `.gitignore` parsing
- **`.graphignore`** — Project-specific ignore file for custom rules (like .gitignore)

### 📚 Framework References
- `get_framework_reference` — Auto-detect project framework and return AI-optimized docs
- Includes: React 18/19, Vue 3, Next.js, Express, Node.js, Symbiote.js

### 📘 Agent Instructions
- `get_agent_instructions` — Get coding guidelines, JSDoc format, architecture standards
- [AGENT_ROLE.md](AGENT_ROLE.md) — Full system prompt for agents
- [AGENT_ROLE_MINIMAL.md](AGENT_ROLE_MINIMAL.md) — Minimal variant (agent self-discovers)

### 💡 Response Hints
Every tool response includes contextual coaching hints:
- `get_skeleton` → "Use expand() to see code, deps() for architecture"
- `invalidate_cache` → "Cache cleared. Run get_skeleton() to rebuild"
- `get_dead_code` → "Review before removing — some may be used dynamically"
- `get_undocumented` → "Use generate_jsdoc() for auto-generation"
- Large classes auto-detected → "Run get_complexity() to find refactoring targets"

### 🛡️ Security
- **Path Traversal Protection** — all tool paths validated to stay within workspace root
- **Workspace Isolation** — MCP roots set workspace boundary, tools cannot escape it

### 🌐 MCP Ecosystem
Best used together with [**agent-pool-mcp**](https://www.npmjs.com/package/agent-pool-mcp) — multi-agent task delegation via Gemini CLI:

| Layer | project-graph-mcp | agent-pool-mcp |
|-------|-------------------|----------------|
| **Primary IDE agent** | Navigates codebase, runs analysis | Delegates tasks, consults peer |
| **Gemini CLI workers** | Available as MCP tool inside workers | Executes delegated tasks |

Combined config for both:

```json
{
  "mcpServers": {
    "project-graph": {
      "command": "npx",
      "args": ["-y", "project-graph-mcp"]
    },
    "agent-pool": {
      "command": "npx",
      "args": ["-y", "agent-pool-mcp"]
    }
  }
}
```

## Installation

Add to your IDE's MCP configuration:

```json
{
  "mcpServers": {
    "project-graph": {
      "command": "npx",
      "args": ["-y", "project-graph-mcp"]
    }
  }
}
```

Restart your IDE — project-graph-mcp will be downloaded and started automatically.  
**Zero dependencies** — only Node.js >= 18 required.

<details>
<summary>📍 Where is my MCP config file?</summary>

| IDE | Config path |
|-----|------------|
| Antigravity | `~/.gemini/antigravity/mcp_config.json` |
| Gemini CLI | `~/.gemini/settings.json` |
| Cursor | `.cursor/mcp.json` |
| Windsurf | `.windsurf/mcp.json` |
| Claude Code | Run: `claude mcp add project-graph npx -y project-graph-mcp` |

See **[CONFIGURATION.md](CONFIGURATION.md)** for all supported IDEs.

</details>

<details>
<summary>📦 Alternative: from source</summary>

```bash
git clone https://github.com/rnd-pro/project-graph-mcp
cd project-graph-mcp
# No npm install needed — zero dependencies
# Use "node /path/to/project-graph-mcp/src/server.js" as the command in MCP config
```

</details>

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

## .graphignore

Exclude files from custom rules checking (useful for files containing code examples):

```
# Comments start with #
instructions.js          # Exact filename
outdated-patterns.js     # Files with code examples
*.min.js                 # Glob suffix
dist/*                   # Glob prefix
```

Searches parent directories automatically (like .gitignore).

## Architecture

```
project-graph-mcp/
├── src/
│   ├── server.js             # Entry point (CLI/MCP mode switch)
│   ├── mcp-server.js         # MCP server + response hints
│   ├── cli.js / cli-handlers.js  # CLI commands
│   ├── tool-defs.js          # MCP tool schemas
│   ├── tools.js              # Graph tools (skeleton, expand, deps)
│   ├── workspace.js          # Path resolution + traversal protection
│   ├── parser.js             # AST parser (Acorn) + language routing
│   ├── lang-typescript.js    # TypeScript/TSX regex parser
│   ├── lang-python.js        # Python regex parser
│   ├── lang-go.js            # Go regex parser
│   ├── lang-utils.js         # Shared: stripStringsAndComments
│   ├── graph-builder.js      # Minified graph + legend
│   ├── filters.js            # Exclude patterns, .gitignore
│   ├── dead-code.js          # Unused code detection
│   ├── complexity.js         # Cyclomatic complexity
│   ├── similar-functions.js  # Duplicate detection
│   ├── large-files.js        # File size analysis
│   ├── outdated-patterns.js  # Legacy pattern detection
│   ├── full-analysis.js      # Health Score (0-100)
│   ├── undocumented.js       # Missing JSDoc finder
│   ├── jsdoc-generator.js    # JSDoc template generation
│   ├── custom-rules.js       # Configurable lint rules
│   ├── framework-references.js # Framework-specific docs
│   ├── test-annotations.js   # @test/@expect parsing
│   └── instructions.js       # Agent guidelines
├── rules/                    # Pre-built rule sets (JSON)
├── references/               # Framework reference docs
├── vendor/
│   ├── acorn.mjs             # AST parser (MIT, vendored)
│   └── walk.mjs              # AST walker (MIT, vendored)
└── tests/
    ├── parser.test.js
    └── mcp.test.js
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
