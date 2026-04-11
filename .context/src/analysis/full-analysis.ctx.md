# full-analysis.js

## Notes
- Orchestrates the execution of all individual analysis modules to generate a single comprehensive health report
- Calculates an overall health score (0-100) by applying capped penalties for different issue types
- Uses an incremental caching system (`analysis-cache.js`) to speed up per-file metrics (complexity, undocumented, jsdoc)
- Emits a top-level rating (`excellent`, `good`, `warning`, `critical`) and a list of the top 5 most severe issues

## Edge Cases
- Cross-file metrics (dead code, similar functions) cannot be reliably cached per-file and are always recomputed dynamically
- Database usage metrics (from `db-analysis.js`) are included in the final payload if found but do not impact the health score
- Cache keys are stored relative to the workspace root, meaning caches remain valid even if the project is moved

## Decisions
- Penalties are strictly capped per category (e.g., max -20 for complexity) so that a massive number of minor issues in one category doesn't completely eclipse the rest of the score
- The `Promise.all` approach for cross-file metrics ensures they run concurrently to minimize the latency penalty of dynamic execution

## TODO
- Add historical score tracking to measure health degradation or improvement over time
- Allow projects to define custom weights for the penalty scoring via configuration