# Changelog

All notable changes to this project will be documented in this file.

## [2.2.8] — 2026-04-24

### Fixed
- **Skeleton exports regression**: `createSkeleton()` was pushing `{id, l}` objects instead of plain string IDs into the `X` (exports) field. This broke `ctx-panel`, `dep-graph`, and integration tests. Exports now consistently contain string legend keys.
- **Expand pipeline crash**: `expandFile()` would crash with `Unexpected token` when scope-aware variable renaming produced invalid JS (e.g., callback parameter shadowing). Now falls back to beautified code without rename when re-parse fails.
- **Console.log pollution**: Removed debug `console.log` and `console.time` calls from `dep-graph.js` and `ActionBoard.js` that leaked into the browser console.

### Added
- **`.npmignore`**: Excludes debug artifacts (`web/debug-*`, `web/test-*`, `web/tune-*`), unused vendor directories (`engine/`, `demo/`, `tests/`), `.context/`, and internal tooling from the published npm package. Reduces package from 301 to ~237 files.
- **`.gitignore` patterns**: Added patterns for debug/test files to prevent re-committing.

### Removed
- 9 debug/temp files removed from repository: `patch.js`, `temp_output.txt`, `temp_output_rects.txt`, `test-graph.js`, `web/debug-patch.js`, `web/debug-sleep.js`, `web/test-force-sim.html`, `web/test-graph-data.json`, `web/tune-physics.js`.
- `"files"` whitelist from `package.json` (replaced by `.npmignore` for granular exclusion control).

## [2.2.7] — 2026-04-22

### Added
- Force-directed graph layout with ForceWorker (continuous mode, live tick feedback)
- Hierarchical directory nesting with universal URL routing (`#graph/path/to/dir`)
- Focus-driven graph exploration mode (radial layout with imports/dependents hemispheres)
- File tree sidebar with bidirectional sync to graph view
- Path style toggle (PCB/orthogonal, straight, bezier)
- Mode toggle URL routing (`?mode=flat|tree`)
- Code viewer two-way linking with file tree and graph
- Depth-of-field effect during node drag interaction

### Fixed
- Graph navigation routing stability (URL path corruption, deep-linking)
- Force layout convergence and phantom position sync
- Node overlap inside subgraphs on page refresh
- LOD phantom promotion and text clipping
- PCB obstacle avoidance threshold at >200 nodes
- Severe lag when toggling TREE/FLAT inside subgraph

### Changed
- Migrated from d3-force to pure force layout engine (zero external dependencies)
- Centralized fitView, flyToNode, LOD, and PinExpansion logic in symbiote-node
- `symbiote-node` updated to v0.3.0 with 41/41 force layout tests passing

## [2.2.5] — 2026-04-08

### Added
- Expand pipeline with JSDoc injection from `.ctx` documentation
- Scope-aware identifier deduplication in expand renaming
- Validate pipeline for compact ↔ expand round-trip integrity

## [2.2.4] — 2026-03-28

### Added
- Web explorer with interactive dependency graph visualization
- SubgraphRouter for hierarchical graph navigation
- Canvas-based graph rendering with LOD system
