# Project Graph MCP Usage Guide
A comprehensive guide to analyzing, navigating, and auditing codebases efficiently using project-graph.

## Recommended Workflow
Typical order of operations for codebase analysis and modification:
1. `get_skeleton("src/")` → understand project structure
2. `deps("ClassName")` → map dependencies before changes
3. [make code changes]
4. `invalidate_cache()` → ALWAYS after edits
5. `get_full_analysis("src/")` → verify code quality

## Navigation
Quickly understand the structure and find your way around the codebase. Use this to get an overview without reading every file.
Example:
```javascript
// Get a compact overview of the entire src directory
get_skeleton({ path: "src/" });
```

## Analysis
Evaluate code quality, complexity, and find potential issues like dead code or outdated patterns.
Example:
```javascript
// Check for unused functions, classes, exports
get_dead_code({ path: "src/utils" });
```

## Testing
Manage and track testing progress using annotations.
Example:
```javascript
// View pending tests from @test annotations
get_pending_tests({ path: "src/components" });
```

## Documentation
Identify undocumented code and automatically generate JSDoc templates.
Example:
```javascript
// Find functions missing JSDoc annotations
get_undocumented({ path: "src/", level: "all" });
```

## Rules
Manage custom analysis rules to enforce project-specific conventions.
Example:
```javascript
// Check a directory against a custom ruleset
check_custom_rules({ path: "src/", ruleSet: "react" });
```

## Workflow
Use these tools to manage the analysis state and cache.
Example:
```javascript
// Clear the internal graph cache after making edits
invalidate_cache({});
```
