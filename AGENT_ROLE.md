# Project Graph MCP - Agent Role

You have access to **Project Graph MCP** — a suite of code analysis and project navigation tools.

## 🧭 Navigation & Understanding
| Tool | Purpose |
|------|---------|
| `get_structure` | Get file/folder tree |
| `get_skeleton` | Get code structure (classes, functions, exports) |
| `expand` | Deep dive into a class or function |
| `get_agent_instructions` | Get project coding guidelines |
| `get_framework_reference` | Get framework AI reference (auto-detects or explicit) |

## 🧪 Testing System

| Tool | Purpose |
|------|---------|
| `get_pending_tests` | List @test/@expect annotations needing verification |
| `mark_test_passed` / `mark_test_failed` | Track test results |
| `get_test_summary` | Progress report |

### When to Write @test/@expect
Add annotations to JSDoc when creating or modifying **interactive methods**:
- `onclick` / `onchange` / `oninput` event handlers
- Methods that change DOM state (show/hide, toggle classes/attributes)
- Navigation and routing methods
- Form submission and validation handlers
- Any method with user-visible side effects

### Browser Testing Workflow (VERIFICATION mode)
After code changes, you MUST verify UI with this flow:

```
1. get_pending_tests(path)           → see what needs verification
2. Open browser via browser_subagent → execute each test step
3. mark_test_passed(testId)          → or mark_test_failed(testId, reason)
4. get_test_summary(path)            → final report before completing task
```

**Rule**: If `get_pending_tests()` returns items, they MUST be executed in the browser before the task is marked complete. Never skip browser verification when @test annotations exist.

### Example
```javascript
/**
 * Delete selected persona
 *
 * @test click: Click delete button on persona card
 * @test click: Confirm in dialog
 * @expect element: Persona removed from list
 * @expect visual: Toast notification appears
 */
async onDeletePersona() { ... }
```

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

## 🔍 Code Quality Analysis
| Tool | Purpose |
|------|---------|
| `get_full_analysis` | Run ALL checks + Health Score (0-100) |
| `get_dead_code` | Find unused functions/classes |
| `get_undocumented` | Find missing JSDoc |
| `get_similar_functions` | Detect code duplicates |
| `get_complexity` | Cyclomatic complexity metrics |
| `get_large_files` | Files needing split |
| `get_outdated_patterns` | Legacy patterns + redundant npm deps |
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

### Pre-built Rulesets (85 rules)
| Ruleset | Rules | Framework |
|---------|-------|-----------|
| `symbiote-2x` | 12 | Symbiote.js 2.x |
| `symbiote-3x` | 17 | Symbiote.js 3.x |
| `react-18` | 6 | React 18 |
| `react-19` | 5 | React 19 (Server Components) |
| `vue-3` | 5 | Vue 3 Composition API |
| `nextjs-15` | 6 | Next.js 15 App Router |
| `express-5` | 5 | Express.js 5.x |
| `fastify-5` | 5 | Fastify 5.x |
| `nestjs-10` | 6 | NestJS 10.x |
| `typescript-5` | 5 | TypeScript 5.x |
| `node-22` | 7 | Node.js 22+ |

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

## 🚀 Recommended Workflow

1. **Start**: `get_structure` → understand project layout
2. **Dive**: `get_skeleton` → map code architecture
3. **Analyze**: `get_full_analysis` → find issues (Health Score)
4. **Check Rules**: `check_custom_rules` → framework-specific violations
5. **Fix**: Address issues by severity (error → warning → info)
6. **Verify**: `get_pending_tests` → execute in browser → `mark_test_passed/failed` → `get_test_summary`
