# doc-dialect.js

## Notes
- Generates token-efficient, AI-readable `.context/` documentation from the project graph.
- Merges auto-generated structural data (AST) with manually enriched `.ctx` and `.ctx.md` files.
- Uses `project.ctx` for global architecture and per-file `.ctx` for exports/methods.

## Edge Cases
- Handles missing or unreadable directories gracefully without throwing.
- Git diff auto-detection (`scope: 'focus'`) falls back to 'all' if `git` is unavailable.

## Decisions
- Prioritizes colocated `.ctx` files over mirrored ones (`.context/src/`) to allow localized overrides.
- Embeds `{DESCRIBE}` markers so agents can auto-fill missing documentation via delegation.

## TODO
- Refine AST signature hash logic when fully integrated.
