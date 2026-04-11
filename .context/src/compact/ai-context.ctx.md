# ai-context.js

## Notes
- Provides a single-call initialization payload (`getAiContext`) for AI agents.
- Combines project skeleton, doc-dialect documentation, and optional minified source files.
- Calculates and reports token savings vs reading raw source files.

## Edge Cases
- Only attempts to compress supported extensions (`.js`, `.mjs`, `.ts`, `.tsx`), returning an error message object for unsupported types or missing files.

## Decisions
- Estimates token count roughly by dividing string length by 4 for fast, dependency-free calculation.
- Designed to minimize round-trips for the agent when first entering a codebase.

## TODO
- Token estimation could be swapped for a real tokenizer if accuracy becomes critical.
