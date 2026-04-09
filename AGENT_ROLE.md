# Project Graph MCP - Agent Role

You have access to **Project Graph MCP** — a suite of code analysis and project navigation tools.

## 🧭 Navigation & Understanding
| Tool | Purpose |
|------|---------|
| `get_skeleton` | Get compact code structure (classes, functions, exports) |
| `expand` | Deep dive into a class or function |
| `get_focus_zone` | Get enriched context for recently modified files |
| `get_call_chain` | Find shortest path between two symbols |
| `usages` | Find all usages of a symbol across the project |
| `deps` | Get dependency tree for a symbol |
| `get_agent_instructions` | Get project coding guidelines |
| `get_framework_reference` | Get framework AI reference (auto-detects or explicit) |
| `get_usage_guide` | Get full usage guide with examples |
| `invalidate_cache` | Refresh graph after code changes (MANDATORY after edits) |

## 🧪 Testing System

| Tool | Purpose |
|------|---------|
| `get_pending_tests` | List `[ ]` checklists from `.ctx.md` files |
| `mark_test_passed` / `mark_test_failed` | Write `[x]` or `[!]` directly to `.ctx.md` |
| `get_test_summary` | Progress report |
| `reset_test_state` | Reset all checklists to `[ ]` |

### How Test Checklists Work
Tests live in `.ctx.md` files (the "agent zone" of the two-tier documentation), not in source code:

```markdown
# parser.js

## Tests
- [ ] Parse valid JS file with classes and functions
- [ ] Handle syntax errors gracefully
- [x] Parse empty file without crash
```

### Browser Testing Workflow (VERIFICATION mode)
After code changes, you MUST verify UI with this flow:

```
1. get_pending_tests(path)           → see what needs verification
2. Open browser via browser_subagent → execute each test step
3. mark_test_passed(testId)          → or mark_test_failed(testId, reason)
4. get_test_summary(path)            → final report before completing task
```

**Rule**: If `get_pending_tests()` returns items, they MUST be executed before the task is marked complete.

> **Note**: Test state is persistent (written to files) and survives agent session restarts.

## 🗄️ Database Analysis
| Tool | Purpose |
|------|---------|
| `get_db_schema` | Extract tables, columns, types from .sql files |
| `get_table_usage` | Show which functions read/write each table |
| `get_db_dead_tables` | Find schema tables/columns never referenced in code |

### How It Works
The graph automatically detects SQL queries in your code:
- **Tagged templates**: `` sql`SELECT * FROM users` ``
- **DB client calls**: `.query()`, `.execute()`, `.raw()`, `.exec()`, `.queryFile()`, `.one()`, `.none()`, `.many()`, `.any()`, `.oneOrNone()`, `.manyOrNone()`, `.result()`
- **String literals**: SQL-anchored strings (`SELECT`, `INSERT`, `UPDATE`, `DELETE`, `WITH`)
- **Schema files**: `CREATE TABLE` statements from `.sql` files

### Limitations
- Regex-based (~80% accuracy). Dynamic SQL (string concatenation) may be missed.
- Column-level dead code detection is best-effort.
- ORM-specific patterns (Prisma, Sequelize, Knex query builder) are not yet supported.

## 🧠 AI Context Layer
| Tool | Purpose |
|------|---------|
| `get_ai_context` | **Boot**: skeleton + docs + compressed files in one call |
| `get_compressed_file` | Terser-minified source with export legend |
| `get_project_docs` | Doc Dialect documentation (auto + manual .context/) |
| `generate_context_docs` | Generate .context/ templates from AST (batch concurrent) |
| `check_stale_docs` | Detect outdated .ctx files by @sig hash |
| `discover_sub_projects` | Find sub-projects in monorepo (packages/apps/services/...) |
| `get_analysis_summary` | Quick health score — cached metrics only, skips cross-file |

### AI-First Workflow
1. **Boot**: `get_ai_context(path)` — loads skeleton + docs (~1700 tokens vs ~60K original)
2. **Drill**: `expand(symbol)` or `get_compressed_file(file)` — go deeper when needed
3. **Enrich**: `generate_context_docs(path)` creates `.context/*.ctx` with `{DESCRIBE}` markers. Fill them with compact descriptions.

### Doc Dialect Storage (Two-Tier)
`.context/` mirrors your source tree with two files per source:
```
.context/                  ← auto-generated (mirror)
├── project.ctx
├── parser.ctx             ← Machine zone: AST signatures, @sig
├── parser.ctx.md          ← Agent zone: notes, TODO, decisions
└── utils/
    └── helpers.ctx

src/
├── parser.js
├── parser.ctx             ← colocated override (wins!)
└── utils/
    └── helpers.js
```

### Doc Dialect Format
`.context/` files use a compact pipe-separated format:
```
--- parser.js ---
export parseProject()→resolve,findJSFiles,readFileSync|scans dir, parses all files
parseFileByExtension()→parseSQL,parsePython,parseGo|routes by extension
PATTERNS: lang-*.js for non-JS|regex fallback for Python
EDGE_CASES: Python uses regex, not AST|Go interfaces ≠ classes
```

### Enrichment Workflow
| Step | How |
|------|-----|
| 1. Generate | `generate_context_docs` creates templates with `{DESCRIBE}` markers + `@sig` hash |
| 2. Enrich | Delegate to agent-pool: `delegate_task({ skill: "doc-enricher" })` |
| 3. Monitor | `check_stale_docs` detects when source changes invalidate docs |
| 4. Update | Regenerate with `overwrite: true` — existing descriptions are preserved |

## 🔍 Code Quality Analysis
| Tool | Purpose |
|------|---------|
| `get_full_analysis` | Run ALL checks + Health Score (0-100) |
| `get_analysis_summary` | Quick health score (cached only, fast) |
| `get_dead_code` | Find unused functions/classes |
| `get_undocumented` | Find missing JSDoc |
| `get_similar_functions` | Detect code duplicates |
| `get_complexity` | Cyclomatic complexity metrics |
| `get_large_files` | Files needing split |
| `get_outdated_patterns` | Legacy patterns + redundant npm deps |
| `check_jsdoc_consistency` | Validate JSDoc ↔ AST signatures |
| `check_types` | Optional tsc type checking (requires TypeScript) |
| `generate_jsdoc` | Auto-generate JSDoc templates |

## 🔧 Custom Rules (Configurable)
| Tool | Purpose |
|------|---------|
| `get_custom_rules` | List all rulesets |
| `set_custom_rule` | Add/update framework-specific rules |
| `check_custom_rules` | Run analysis (auto-detects applicable rules) |

### Auto-Detection
Rules are applied automatically based on:
- `package.json` dependencies (e.g., `@symbiotejs/symbiote`)
- Import patterns in source code
- Code patterns (e.g., `extends Symbiote`)

### Pre-built Rulesets (86 rules)
| Ruleset | Rules | Framework |
|---------|-------|-----------|
| `symbiote-2x` | 12 | Symbiote.js 2.x |
| `symbiote-3x` | 18 | Symbiote.js 3.x |
| `react-18` | 6 | React 18 |
| `react-19` | 5 | React 19 (Server Components) |
| `vue-3` | 5 | Vue 3 Composition API |
| `nextjs-15` | 6 | Next.js 15 App Router |
| `express-5` | 5 | Express.js 5.x |
| `fastify-5` | 5 | Fastify 5.x |
| `nestjs-10` | 6 | NestJS 10.x |
| `typescript-5` | 5 | TypeScript 5.x |
| `node-22` | 13 | Node.js 22+ |

### Creating New Rules
Read project workflow docs (e.g., `.agent/workflows/symbiote-audit.md`) and use `set_custom_rule`:
```json
{
  "ruleSet": "framework-2x",
  "rule": {
    "id": "framework-no-antipattern",
    "name": "Avoid antipattern",
    "pattern": "badCode",
    "patternType": "string",
    "replacement": "Use goodCode",
    "severity": "warning",
    "filePattern": "*.js",
    "docs": "https://docs.example.com"
  }
}
```

## ⚙️ Filters
| Tool | Purpose |
|------|---------|
| `get_filters` / `set_filters` | Configure excluded directories |
| `add_excludes` / `remove_excludes` | Modify exclude list |
| `reset_filters` | Reset to defaults |

## 🚀 Recommended Workflow

1. **Boot**: `get_ai_context` → understand entire project in ~1700 tokens
2. **Dive**: `expand` / `get_compressed_file` → drill into specific files
3. **Analyze**: `get_full_analysis` → find issues (Health Score)
4. **Check Rules**: `check_custom_rules` → framework-specific violations
5. **Fix**: Address issues by severity (error → warning → info)
6. **Verify**: `get_pending_tests` → execute in browser → `mark_test_passed/failed` → `get_test_summary`
7. **Document**: `generate_context_docs` → enrich .ctx files with PATTERNS and EDGE_CASES
