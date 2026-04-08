# custom-rules.js

## Notes
- A JSON-driven linting engine that runs regex or string matching rules across the codebase
- Features an auto-detection system (`detectProjectRuleSets`) that enables specific rulesets based on `package.json` dependencies (e.g., enabling React rules if `react` is found)
- Rules can specify `contextRequired` (like `<template>`) to restrict matches to certain HTML/JSX tag blocks
- Fully supports a hierarchical `.graphignore` file to exclude specific paths or globs from all custom rules

## Edge Cases
- The `isInStringOrComment` heuristic is simple for performance and may fail on complex multi-line strings or block comments (`/* ... */`)
- When auto-detecting via file content instead of `package.json`, it only scans the first 50 `.js` files to prevent massive latency spikes
- Duplicated violations across multiple overlapping rulesets are automatically deduplicated by file, line, and match text

## Decisions
- Chosen line-by-line regex matching over full AST traversal for custom rules to make rule authoring simple for end users (no AST knowledge required)
- Storing rules as separate JSON files in the `/rules` directory allows easy community sharing and versioning of rulesets

## TODO
- Implement full block comment awareness for the string/comment exclusion heuristic
- Add auto-fix application functionality using the `replacement` field in rule definitions