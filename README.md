[![npm version](https://img.shields.io/npm/v/project-graph-mcp)](https://www.npmjs.com/package/project-graph-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-339933?logo=node.js&logoColor=white)](https://nodejs.org)

# project-graph-mcp

**Maximize your AI agent's context window.** An MCP server that lets agents read and edit your codebase in **compact mode** — minified source with all variable names preserved. Code tokens drop **↓40%**, and `.ctx` documentation is injected only in the focus zone. Fewer tokens per file → more files fit in context → **deeper understanding of your codebase**.

![Expanded view — formatted code with JSDoc, 28+ lines per function](https://raw.githubusercontent.com/rnd-pro/project-graph-mcp/main/docs/img/explorer-expanded.jpg)

![Compact mode — same file, 14 lines total, ↓40% tokens. Agents read and edit this directly.](https://raw.githubusercontent.com/rnd-pro/project-graph-mcp/main/docs/img/explorer-compact.jpg)

Includes a built-in [Web Dashboard](#web-dashboard) (`npx project-graph-mcp serve`) to visualize token metrics and compact ⇄ raw code in real-time.

> [!TIP]
> **18 MCP tools, zero config.** Add one line to your MCP config and the server downloads itself on the next IDE restart.

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
- **Health Score (0-100)** — aggregated result from all checks in one call (`get_full_analysis` or quick `get_analysis_summary`)
- **Incremental cache** — per-file analysis results cached in `.context/.cache/` with content hashing

### AI Context Layer

One call loads everything an agent needs to understand a project:

```javascript
get_ai_context({ path: "src/" })
// → { skeleton, docs, totalTokens: 3150, savings: "93%" }
```

- **Code compression** — Terser-minified source with export legend headers (20-55% per file)
- **Compact Code Mode** — project-wide `compact`/`beautify` (preserves all names, strips comments/whitespace)
- **Doc Dialect** — compact `.context/` documentation format, auto-generated from AST with `{DESCRIBE}` markers. Descriptions use a **simplified English dialect** — max 80 characters, pipe-separated, with standard abbreviations (`fn/ret/cfg/init/auth/db/msg`):

```
generateJSDoc(t)→e.push,e.join|build /** */ JSDoc block from .ctx signature
export expandFile(e,n)→beautify,inject|beautify compact JS + inject JSDoc from .ctx
PATTERNS: Terser beautify|AST walk for injection points|reverse-order insertion
```
- **Two-tier `.ctx`** — `.ctx` (machine-generated, AST signatures) + `.ctx.md` (agent notes, TODO, decisions)
- **Self-enriching** — `@enrich` instructions embedded in `.ctx` files guide any AI agent to fill descriptions
- **Staleness detection** — `@sig` hashes track structural changes; `check_stale_docs` identifies outdated docs
- **Merge strategy** — regenerating `.ctx` files preserves existing descriptions
- **Boot aggregator** — `get_ai_context` combines skeleton + docs + compressed files in one response

```bash
# Generate .context/ documentation templates
npx project-graph-mcp generate-ctx src/

# View project docs in compact format
npx project-graph-mcp docs src/

# Compress a single file for AI
npx project-graph-mcp compress src/core/parser.js
```

### Two-Tier Context: Overview → Focus

Agents don't need full context for every file. The server provides a **progressive loading model**:

| Mode | What agent reads | Token cost | Use case |
|------|-----------------|------------|----------|
| **Overview** | `get_skeleton()` + compact code | codeTok only | Understand project structure |
| **Focus** | compact code + `.ctx` for specific files | codeTok + ctxTok (per file) | Deep work on area of interest |
| **Traditional** | All raw source files | expanded | Reading source directly |

```javascript
// 1. Overview: read entire project structure (cheap, no .ctx)
get_skeleton({ path: "src/" })
// → Legend, stats, all classes/functions/exports — ~2-5K tokens

// 2. Focus: get enriched context ONLY for area of interest
get_focus_zone({ recentFiles: ["src/core/parser.js", "src/mcp/tools.js"] })
// → Compact code + .ctx documentation for just those 2 files

// 3. Or auto-detect from git diff
get_focus_zone({ path: ".", useGitDiff: true })
// → Context for recently changed files only
```

**Real-world token budget** (this project's own benchmark, 45 files):

```
Skeleton + docs only:          3.2K tok — 93% savings, full project overview
Compact source (agent reads): 46.9K tok — 20-55% savings per file
```

**Per-file metrics breakdown:**

| Layer | What | Tokens |
|-------|------|--------|
| Code (compact .js) | Minified source, all names preserved | codeTok |
| Context (.ctx) | AST signatures, types, descriptions | ctxTok |
| Total (focus mode) | What agent reads when focusing | codeTok + ctxTok |

### Compact Code Architecture

Two modes for AI-native codebase editing — configure per project via `.context/config.json`:

| Mode | Storage | Agent reads/writes | Human reviews |
|------|---------|-------------------|---------------|
| **1 — Compact** ⭐ | Minified JS | `src/` directly | `.expanded/` cache |
| **2 — Full** | Formatted JS | compressed view | `src/` directly |

**Mode 1 — Compact** (recommended for AI-first projects):

Source of truth is compact code. Agents read and write it directly — saving tokens in **both directions** (input and output). Since output tokens cost 3-5x more than input, compact output is the biggest cost saving. Humans review via auto-generated `.expanded/` cache with restored names and injected JSDoc.

```javascript
// Agent reads and edits compact source directly (20-55% fewer tokens both ways)
// After edits, validate and generate human-readable cache:
compact({ action: "validate_pipeline", path: ".", strict: true })
compact({ action: "expand_project", path: "." })
```

**Mode 2 — Full** (for existing projects, no refactoring needed):

```javascript
// 1. Read compressed view (saves input tokens only)
get_compressed_file({ path: "src/parser.js" })

// 2. Edit by symbol name — server finds it via AST
edit_compressed({
  path: "src/parser.js",
  symbol: "parseFile",
  code: "export async function parseFile(code, filename) { /* new body */ }"
})

// 3. Validate .ctx contracts after editing
validate_ctx_contracts({ path: "." })
```

**Migrating from Full to Compact:**

```bash
# Ensure git is clean, then run automated migration
npx project-graph-mcp compact-migrate .
# → compacts all JS, generates @names in .ctx, sets mode 1, validates
```

**`.ctx` typed signatures** — JSDoc types extracted into compact format:

```
parseFile(code:string,filename:string)→Promise<ParseResult>→parse,walk|parse JS file into AST
```

```bash
# Check current mode
npx project-graph-mcp mode .

# Set project mode
npx project-graph-mcp set-mode . 1

# Validate .ctx documentation matches source
npx project-graph-mcp validate-ctx . --strict
```

### Expand & Validate Pipeline

The compact→expand pipeline is **fully reversible**. Verify round-trip integrity:

```javascript
// Expand a compact file back to full formatted + JSDoc
compact({ action: "expand_file", path: "src/parser.js" })

// Expand entire project
compact({ action: "expand_project", path: ".", dryRun: true })

// Validate compact ↔ expand round-trip
compact({ action: "validate_pipeline", path: ".", strict: true })
// → Reports any functions in source missing from .ctx
```

### Test Checklists

Test checklists live in `.ctx.md` files (alongside documentation), not in source code:

```markdown
## Tests
- [ ] POST /api/users with valid data → 201 Created
- [ ] GET /api/users/:id returns user object
- [x] DELETE /api/users/:id → 204 No Content
```

The agent calls `get_pending_tests`, runs the test, then `mark_test_passed` (which writes `[x]` directly to the `.ctx.md` file). Test state is persistent and survives session restarts.

### Monorepo Support

`discover_sub_projects` scans standard monorepo directories (`packages/`, `apps/`, `services/`, `modules/`, `libs/`, `plugins/`) for sub-projects with `package.json`. Combined with `parseProject({ recursive: true })`, agents can analyze entire monorepos.

### Database Analysis

Scan SQL migrations and code for database schema insights:

```javascript
// Extract schema from SQL/migration files
db({ action: "schema", path: "src/" })

// Find where each table is referenced in code
db({ action: "table_usage", path: "src/", table: "users" })

// Detect tables defined but never queried
db({ action: "dead_tables", path: "src/" })
```

### Web Dashboard

Every project-graph-mcp instance includes a built-in web UI at `http://localhost:{port}/`:

- **Multi-project dashboard** — overview of all registered projects with token metrics
- **File tree** — navigate project structure
- **Code viewer** — compact/raw toggle with syntax highlighting and per-file compression stats
- **Dependency graph** — visual dependency exploration
- **Health panel** — analysis results
- **Live monitor** — real-time agent activity via WebSocket



With the optional gateway, all projects are accessible under `http://project-graph.local/{project-name}/`.

### Compression Metrics

Token-level metrics are available project-wide and per-file:

```javascript
// Project-wide: how many tokens for the entire codebase
// GET /api/compression-stats
// → { files: 45, codeTok: 47000, ctxTok: 9500, totalTok: 56500 }

// Per-file: shown in code viewer header
// 2054 + 527 ctx = 2581 → 3340 tok (23% savings)
```

### Performance

- **Batch concurrency** — `generate_context_docs` processes 5 files in parallel
- **Quick health check** — `get_analysis_summary` runs only cached per-file metrics (skips expensive cross-file analysis)
- **Streaming analysis** — `getFullAnalysisStreaming` yields results incrementally as each sub-analysis completes

### Custom Rules & Framework References

11 pre-built rulesets (86 rules) for React 18/19, Vue 3, Next.js 15, Express 5, Fastify 5, NestJS 10, TypeScript 5, Node.js 22, and [Symbiote.js](https://github.com/symbiotejs/symbiote.js). The server auto-detects your project type and returns adapted documentation via `get_framework_reference`.

Custom project conventions can be added in the `rules/` directory or configured by the agent via `set_custom_rule`.

### Response Hints

Every tool response includes contextual coaching — if the agent finds a massive function, the server suggests checking its complexity. After expanding a class, it hints to explore dependencies.

### Security

**Path Traversal Protection** — all incoming paths are validated using `resolve` and `startsWith`. The agent cannot escape the working directory. An attempt to read `../../etc/passwd` returns a direct error.

## Quick Start

Generate the MCP config for your IDE (with correct paths):

```bash
npx -y project-graph-mcp config
```

Copy the output JSON into your IDE's MCP config file, then restart.

#### Grouped Tools (v2.0)

v2.0 uses 18 domain-grouped tools instead of 49 individual endpoints. Grouped tools use an `action` parameter:

```javascript
navigate({ action: "expand", symbol: "MyClass" })
analyze({ action: "complexity", path: "src/" })
docs({ action: "generate", path: ".", scope: "focus" })
compact({ action: "compact_file", path: "src/parser.js" })
```

10 standalone tools (`get_skeleton`, `get_ai_context`, `invalidate_cache`, etc.) remain unchanged.

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
git clone --recursive https://github.com/rnd-pro/project-graph-mcp
cd project-graph-mcp
npm install
# Use "node /path/to/project-graph-mcp/src/network/server.js" as the command in MCP config
```

> **Note:** The `--recursive` flag is required to fetch the `vendor/symbiote-node` submodule. If you already cloned without it, run:
> ```bash
> git submodule update --init --recursive
> ```

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
npx project-graph-mcp validate-ctx .      # Validate .ctx ↔ source
npx project-graph-mcp mode .             # Show current editing mode
npx project-graph-mcp compact-migrate .  # Migrate formatted -> compact (git must be clean)
npx project-graph-mcp set-mode . 1       # Set mode (1=compact*, 2=full)
npx project-graph-mcp serve .            # Start web dashboard
npx project-graph-mcp help                # All commands
```

## MCP Ecosystem

Best used together with [**agent-pool-mcp**](https://www.npmjs.com/package/agent-pool-mcp) — multi-agent task delegation via [Gemini CLI](https://github.com/google-gemini/gemini-cli):

| Layer | project-graph-mcp | agent-pool-mcp |
|-------|-------------------|----------------|
| **Primary IDE agent** | Navigates codebase, runs analysis | Delegates tasks, consults peer |
| **Gemini CLI workers** | Available as MCP tool inside workers | Executes delegated tasks |

```bash
# Generate configs with correct paths for both servers:
npx -y project-graph-mcp config
npx -y agent-pool-mcp config
# Merge both outputs into your IDE's MCP config file.
```

> [!IMPORTANT]
> Each Gemini CLI worker can have its own project-graph-mcp instance — workers navigate the codebase independently, without blocking the primary agent.

## Documentation

- [CONFIGURATION.md](CONFIGURATION.md) — Setup for all supported IDEs
- [ARCHITECTURE.md](ARCHITECTURE.md) — Source code structure
- [AGENT_ROLE.md](docs/examples/AGENT_ROLE.md) — Full system prompt for agents
- [AGENT_ROLE_MINIMAL.md](docs/examples/AGENT_ROLE_MINIMAL.md) — Minimal variant (agent self-discovers)
- [GUIDE.md](GUIDE.md) — Comprehensive usage guide with all tools
- [ROADMAP.md](docs/ROADMAP.md) — Feature roadmap and backlog

## Related Projects
- [agent-pool-mcp](https://github.com/rnd-pro/agent-pool-mcp) — Multi-agent orchestration via Gemini CLI
- [Symbiote.js](https://github.com/symbiotejs/symbiote.js) — Isomorphic Reactive Web Components framework
- [JSDA-Kit](https://github.com/rnd-pro/jsda-kit) — SSG/SSR toolkit for modern web applications

## License

MIT © [RND-PRO.com](https://rnd-pro.com)

---

**Made with ❤️ by the RND-PRO team**
