# Project Graph MCP

You have **Project Graph MCP** tools available — code analysis, project navigation, and framework-specific linting.

## Quick Start

1. `get_skeleton(path)` — Get code structure (classes, functions, exports)
2. `get_full_analysis(path)` — Health Score (0-100) with all code quality checks
3. `get_agent_instructions` — Project coding guidelines and JSDoc format

## Core Tools

### Navigation
- `get_skeleton` — Compact project overview with symbol legend
- `expand(symbol)` — Deep dive into class/function (use symbols from skeleton's `L` field)
- `deps(symbol)` — Dependency tree (imports, usedBy, calls)
- `usages(symbol)` — Find all usages across project

### Code Quality
- `get_full_analysis` — Run ALL checks + Health Score
- `get_dead_code` — Unused functions/classes  
- `get_undocumented` — Missing JSDoc
- `get_similar_functions` — Code duplicates
- `get_complexity` — Cyclomatic complexity (flags >10)
- `get_large_files` — Files needing split
- `get_outdated_patterns` — Legacy patterns

### Testing
- `get_pending_tests` — List @test/@expect annotations
- `mark_test_passed(testId)` / `mark_test_failed(testId, reason)`
- `get_test_summary` — Progress report

### Custom Rules
- `check_custom_rules(path)` — Run framework-specific analysis (auto-detected)
- `get_custom_rules` — List all rulesets (62 rules across 10 frameworks)
- `set_custom_rule` — Add/update rules

**Pre-built rulesets:** React 18/19, Vue 3, Next.js 15, Express 5, Fastify 5, NestJS 10, TypeScript 5, Node.js 22, Symbiote 2.x

## Workflow

```
1. get_skeleton("src/")        → Understand structure
2. get_full_analysis("src/")   → Find issues (Health Score)
3. check_custom_rules("src/")  → Framework violations
4. Fix by severity: error → warning → info
5. get_pending_tests("src/")   → Verification checklist
```

## Tips

- Skeleton uses minified symbols (e.g., `SN` = `SymNode`). Check `_keys` and `L` fields for legend.
- File paths in results are relative to the scanned directory.
- Use `.graphignore` file to exclude files from custom rules checking.
