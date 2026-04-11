# Project Graph MCP — Usage Guide

## Quick Start Workflow
1. `get_ai_context({ path: "src/" })` → boot AI context (skeleton + docs)
2. `get_focus_zone({ recentFiles: ["src/parser.js"] })` → enriched context for area of interest
3. Make code changes
4. `invalidate_cache()` → always after edits
5. `analyze({ action: "analysis_summary", path: "src/" })` → verify quality

## Two-Tier Context Model
Project Graph MCP operates on a dual-layer context model designed for token efficiency and high context awareness:
- **Skeleton (Overview)**: Provides a high-level map of the whole project (2-5K tokens). It includes file paths, exported symbols, and structural relationships without the implementation details.
- **Focus Zone (Detailed)**: When drilling into specific areas, agents receive the full context for those files (1-3K tokens per file), including implementation and associated `.ctx` documentation.

The key insight: agents read the whole project cheaply via the skeleton, then drill into specific files with full context when needed.

## Navigation
Use the `navigate` tool to explore the codebase structure and dependencies.

```javascript
// Expand a specific symbol to see its definition
navigate({ action: "expand", symbol: "MyClass" });

// Find where a specific file or symbol is imported/used
navigate({ action: "usages", path: "src/parser.js" });

// Get dependencies of a specific file
navigate({ action: "deps", path: "src/core/workspace.js" });

// Trace the call chain for a function
navigate({ action: "call_chain", symbol: "processData" });

// List sub-projects or modules
navigate({ action: "sub_projects" });
```

## Analysis
Use the `analyze` tool to inspect code quality, find issues, and gather metrics.

```javascript
// Get a comprehensive summary of codebase health
analyze({ action: "analysis_summary", path: "src/" });

// Find dead or unused code
analyze({ action: "dead_code", path: "src/" });

// Detect potentially duplicate or similar functions
analyze({ action: "similar_functions", path: "src/" });

// Identify complex files requiring refactoring
analyze({ action: "complexity", path: "src/" });

// Find unusually large files
analyze({ action: "large_files", path: "src/" });

// Check for outdated framework patterns
analyze({ action: "outdated_patterns", path: "src/" });

// Find undocumented code blocks
analyze({ action: "undocumented", path: "src/" });

// Run a full suite of analysis checks
analyze({ action: "full_analysis", path: "src/" });
```

## Compact Code
Use the `compact` tool to compress and expand codebase files, or configure how code is presented to the AI.

```javascript
// Compact a file to its structural essence
compact({ action: "compact_file", path: "src/parser.js" });

// Apply a targeted edit to a compacted file
compact({ action: "edit", path: "src/parser.js", instruction: "Add error handling" });

// Compact all files in a directory
compact({ action: "compact_all", path: "src/" });

// Format and beautify a file
compact({ action: "beautify", path: "src/index.js" });

// Expand a previously compacted file to its full content
compact({ action: "expand_file", path: "src/parser.js" });

// Expand the entire project back to full source
compact({ action: "expand_project" });

// Validate the compact/expand pipeline integrity
compact({ action: "validate_pipeline" });

// Get current compaction mode settings
compact({ action: "get_mode" });

// Set compaction mode (e.g., 'aggressive', 'safe')
compact({ action: "set_mode", mode: "aggressive" });
```

## Documentation (.ctx)
Use the `docs` tool to manage and interact with project context (`.ctx`) files.

```javascript
// Get documentation for a specific file
docs({ action: "get", path: "src/core/workspace.js" });

// Generate missing documentation for a directory
docs({ action: "generate", path: "src/utils/" });

// Check for stale or outdated documentation
docs({ action: "check_stale", path: "src/" });

// Validate interface and API contracts
docs({ action: "validate_contracts", path: "src/" });
```

## Database Analysis
Use the `db` tool to analyze database schemas and queries within the code.

```javascript
// Extract the inferred database schema
db({ action: "schema", path: "src/" });

// Find where specific database tables are accessed
db({ action: "table_usage", table: "users" });

// Identify defined tables that are never queried
db({ action: "dead_tables", path: "src/" });
```

## Testing
Use the `testing` tool to manage and track test states and annotations.

```javascript
// List tests marked as pending or TODO
testing({ action: "pending", path: "tests/" });

// Mark specific tests as passing
testing({ action: "pass", testIds: ["test-123"] });

// Mark specific tests as failing
testing({ action: "fail", testIds: ["test-456"] });

// Get a summary of current test statuses
testing({ action: "summary", path: "tests/" });

// Reset all test statuses
testing({ action: "reset" });
```

## JSDoc
Use the `jsdoc` tool to manage JSDoc comments and type annotations.

```javascript
// Check for inconsistencies between JSDoc and actual code
jsdoc({ action: "check_consistency", path: "src/" });

// Validate JSDoc types
jsdoc({ action: "check_types", path: "src/" });

// Generate missing JSDoc comments
jsdoc({ action: "generate", path: "src/core/" });
```

## Filters
Use the `filters` tool to configure which files the MCP server includes or ignores.

```javascript
// Get current active filters
filters({ action: "get" });

// Set specific inclusion/exclusion patterns
filters({ action: "set", includes: ["src/**/*.js"], excludes: ["tests/"] });

// Add patterns to the exclusion list
filters({ action: "add_excludes", patterns: ["dist/", "build/"] });

// Remove patterns from the exclusion list
filters({ action: "remove_excludes", patterns: ["tests/"] });

// Reset filters to default
filters({ action: "reset" });
```

## Custom Rules
Manage custom linting or architectural rules specific to the project.

```javascript
// Retrieve all custom rules
get_custom_rules();

// Define a new custom rule
set_custom_rule({ name: "no-console", description: "Disallow console.log", pattern: "console\\.log" });

// Check codebase against defined custom rules
check_custom_rules({ path: "src/" });
```

## Self-Discovery Tools
Agents can use these tools to learn about the workspace and available workflows.

```javascript
// Read a specific section of this usage guide
get_usage_guide({ topic: "navigation" });

// Retrieve project-specific coding guidelines and agent rules
get_agent_instructions();

// Fetch framework or library documentation referenced in the project
get_framework_reference({ path: "src/" });
```