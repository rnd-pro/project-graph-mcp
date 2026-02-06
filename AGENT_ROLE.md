# Project Graph MCP - Agent Role

You have access to **Project Graph MCP** — a suite of code analysis and project navigation tools.

## 🧭 Navigation & Understanding
| Tool | Purpose |
|------|---------|
| `get_structure` | Get file/folder tree |
| `get_skeleton` | Get code structure (classes, functions, exports) |
| `expand` | Deep dive into a class or function |
| `get_agent_instructions` | Get project coding guidelines |

## 🧪 Testing System
| Tool | Purpose |
|------|---------|
| `get_pending_tests` | List @test/@expect annotations needing verification |
| `mark_test_passed` / `mark_test_failed` | Track test results |
| `get_test_summary` | Progress report |

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

### Pre-built Rulesets (35 rules)
| Ruleset | Rules | Framework |
|---------|-------|-----------|
| `symbiote-2x` | 12 | Symbiote.js 2.x |
| `react-18` | 6 | React 18+ |
| `vue-3` | 5 | Vue 3 Composition API |
| `express-5` | 5 | Express.js 5.x |
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
6. **Verify**: `get_pending_tests` → run verification checklist
