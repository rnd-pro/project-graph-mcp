# large-files.js

## Notes
- Analyzes files to identify candidates for refactoring or splitting into smaller modules
- Metrics calculated: total lines, function count, class count, and export count
- Computes a "refactoring score" and assigns a rating: `ok`, `warning` (score >= 2), or `critical` (score >= 4)
- Provides specific reasons for the rating (e.g., ">300 lines", ">10 exports")

## Edge Cases
- Arrow functions without a block body (implicit returns) are not counted towards the function total
- Syntax errors cause the file to be treated as empty/ok to prevent analysis from crashing
- Test files and presentation files (`.css.js`, `.tpl.js`) are excluded by the default finder

## Decisions
- Thresholds (lines > 300/500, functions > 10/15, classes > 1/3, exports > 5/10) were chosen based on standard clean code heuristics
- Point system allows a file to be flagged as warning/critical even if it only fails significantly on one metric (e.g., 600 lines)

## TODO
- Consider adding metrics for deeply nested scopes or raw byte size
- Allow custom threshold configuration via a `.gemini/complexity.json` file