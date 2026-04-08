[![npm version](https://img.shields.io/npm/v/project-graph-mcp)](https://www.npmjs.com/package/project-graph-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![Zero Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)](https://www.npmjs.com/package/project-graph-mcp)

# project-graph-mcp

An MCP server that parses your source code into a **10-50x compressed skeleton** — classes, functions, imports, and dependencies in a minified JSON. Agents navigate the graph using `expand`, `deps`, and `usages` without reading irrelevant files. The **AI Context Layer** compresses an entire codebase into ~1700 tokens (97% savings) with a single `get_ai_context` call.

> [!TIP]
> **132 kB, 47 files, zero external dependencies.** Add one line to your MCP config and the server downloads itself on the next IDE restart.

### Project Skeleton (10-50x compression)

The server builds an AST-based graph of your project and outputs a minified JSON representation. The agent reads this to understand the architecture. When it needs deeper details, it calls `expand` or `deps`:

```json
{
  "L": { "SN": "SymNode", "SNG": "SymNodeGraph" },
  "s": { "files": 23, "classes": 10, "functions": 65 },
  "n": { "SN": { "m": 11, "$": 7 }, "SNG": { "m": 16, "$": 5 } },
  "e": 35, "o": 7, "d": 5, "F": 63
}
```

`L` = legend (actual symbol names), `s` = stats, `n` = nodes with methods/properties, `e` = edges, `o` = orphans, `d` = duplicates, `F` = functions.

### Multi-Language Parsers

JavaScript is parsed via AST (Acorn). TypeScript, Python, and Go use lightweight regex-based parsers — no heavy external binaries, just enough to extract classes, functions, imports, and calls. All parsers return a unified `ParseResult` structure.

```javascript
// Python — triple quotes, hash comments
stripStringsAndComments(code, { tripleQuote: true, hashComment: true })

// Go — backtick strings without interpolation
stripStringsAndComments(code, { backtick: true, templateInterpolation: false })
```

### Code Quality Analysis

- **Dead code detection** — unused functions, classes, exports, variables, and imports
- **Cyclomatic complexity** — flags functions over threshold, identifies refactoring targets
- **Duplicate detection** — finds functionally similar functions by signature + structure similarity
- **Large file analysis** — candidates for splitting by lines, functions, and exports count
- **Legacy pattern finder** — outdated code patterns and redundant npm deps (built into Node.js 18+)
- **JSDoc consistency** — validates `@param` count/names and `@returns` against AST signatures
- **Type checking** — optional `tsc --checkJs` wrapper with graceful fallback
- **Health Score (0-100)** — aggregated result from all checks in one call
- **Incremental cache** — per-file analysis results cached in `.context/.cache/` with content hashing

### AI Context Layer

One call loads everything an agent needs to understand a project:

```javascript
get_ai_context({ path: "src/" })
// → { skeleton, docs, totalTokens: 1742, savings: "97%" }
```

- **Code compression** — Terser-minified source with export legend headers (20-55% per file)
- **Doc Dialect** — compact `.context/` documentation format, auto-generated from AST with `{DESCRIBE}` markers
- **Two-tier `.ctx`** — `.ctx` (machine-generated, AST signatures) + `.ctx.md` (agent notes, TODO, decisions)
- **Self-enriching** — `@enrich` instructions embedded in `.ctx` files guide any AI agent to fill descriptions
- **Staleness detection** — `@sig` hashes track structural changes; `check_stale_docs` identifies outdated docs
- **Merge strategy** — regenerating `.ctx` files preserves existing descriptions
- **Boot aggregator** — `get_ai_context` combines skeleton + docs + compressed files in one response

```
# Generate .context/ documentation templates
npx project-graph-mcp generate-ctx src/

# View project docs in compact format
npx project-graph-mcp docs src/

# Compress a single file for AI
npx project-graph-mcp compress src/parser.js
```

### Test Checklists

JSDoc annotations (`@test` and `@expect`) define test checklists directly in the code:

```javascript
/**
 * Create new user via API
 *
 * @test request: POST /api/users with valid data
 * @expect status: 201 Created
 */
async createUser(data) { ... }
```

The agent calls `get_pending_tests`, runs the test, then `mark_test_passed`. Supports browser, API, CLI, and integration test types.

### Custom Rules & Framework References

11 pre-built rulesets (86 rules) for React 18/19, Vue 3, Next.js 15, Express 5, Fastify 5, NestJS 10, TypeScript 5, Node.js 22, and [Symbiote.js](https://github.com/symbiotejs/symbiote.js). The server auto-detects your project type and returns adapted documentation via `get_framework_reference`.

Custom project conventions can be added in the `rules/` directory or configured by the agent via `set_custom_rule`.

### Response Hints

Every tool response includes contextual coaching — if the agent finds a massive function, the server suggests checking its complexity. After expanding a class, it hints to explore dependencies.

### Security

**Path Traversal Protection** — all incoming paths are validated using `resolve` and `startsWith`. The agent cannot escape the working directory. An attempt to read `../../etc/passwd` returns a direct error.

## Quick Start

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

<details>
<summary>Where is my MCP config file?</summary>

| IDE | Config path |
|-----|------------|
| Antigravity | `~/.gemini/antigravity/mcp_config.json` |
| Gemini CLI | `~/.gemini/settings.json` |
| Cursor | `.cursor/mcp.json` |
| Windsurf | `.windsurf/mcp.json` |
| Claude Code | Run: `claude mcp add project-graph npx -y project-graph-mcp` |

See **[CONFIGURATION.md](CONFIGURATION.md)** for all supported IDEs (Antigravity, Gemini CLI, Cursor, VS Code, Zed, Claude Desktop, OpenCode, Jenova, Firebase Genkit, NVIDIA AIQ).

</details>

<details>
<summary>Alternative: from source</summary>

```bash
git clone https://github.com/rnd-pro/project-graph-mcp
cd project-graph-mcp
# No npm install needed — zero dependencies
# Use "node /path/to/project-graph-mcp/src/server.js" as the command in MCP config
```

</details>

## CLI

```bash
npx project-graph-mcp skeleton src/       # Project skeleton
npx project-graph-mcp expand SN           # Expand minified symbol
npx project-graph-mcp deps SNG            # Get dependencies
npx project-graph-mcp deadcode src/       # Find unused code
npx project-graph-mcp complexity src/     # Cyclomatic complexity
npx project-graph-mcp similar src/        # Find duplicates
npx project-graph-mcp pending src/        # List pending tests
npx project-graph-mcp compress src/f.js   # Compress file for AI
npx project-graph-mcp docs src/           # Project docs (doc-dialect)
npx project-graph-mcp generate-ctx src/   # Generate .context/ docs
npx project-graph-mcp help                # All commands
```

## MCP Ecosystem

Best used together with [**agent-pool-mcp**](https://www.npmjs.com/package/agent-pool-mcp) — multi-agent task delegation via [Gemini CLI](https://github.com/google-gemini/gemini-cli):

| Layer | project-graph-mcp | agent-pool-mcp |
|-------|-------------------|----------------|
| **Primary IDE agent** | Navigates codebase, runs analysis | Delegates tasks, consults peer |
| **Gemini CLI workers** | Available as MCP tool inside workers | Executes delegated tasks |

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

> [!IMPORTANT]
> Each Gemini CLI worker can have its own project-graph-mcp instance — workers navigate the codebase independently, without blocking the primary agent.

## Documentation

- [CONFIGURATION.md](CONFIGURATION.md) — Setup for all supported IDEs
- [ARCHITECTURE.md](ARCHITECTURE.md) — Source code structure
- [AGENT_ROLE.md](AGENT_ROLE.md) — Full system prompt for agents
- [AGENT_ROLE_MINIMAL.md](AGENT_ROLE_MINIMAL.md) — Minimal variant (agent self-discovers)

## Related Projects
- [agent-pool-mcp](https://github.com/rnd-pro/agent-pool-mcp) — Multi-agent orchestration via Gemini CLI
- [Symbiote.js](https://github.com/symbiotejs/symbiote.js) — Isomorphic Reactive Web Components framework
- [JSDA-Kit](https://github.com/rnd-pro/jsda-kit) — SSG/SSR toolkit for modern web applications

## License

MIT © [RND-PRO.com](https://rnd-pro.com)

---

**Made with ❤️ by the RND-PRO team**
