# compress.js

## Notes
- Uses Terser to minify JS/TS files to save context tokens for AI consumption.
- Strips comments, whitespace, and dead code but explicitly preserves variable/function names (`mangle: false`).
- Generates a compact header legend from exported JSDoc comments.

## Edge Cases
- If Terser minification fails (e.g., due to unsupported syntax), falls back to a regex-based comment/whitespace stripper instead of failing completely.
- Only captures JSDoc within 500 characters of a declaration to avoid grabbing module-level docs.

## Decisions
- Keeps `module: true` and `mangle: false` to ensure the output remains highly readable for LLMs.
- JSDoc extraction uses `acorn` and `walk` to accurately attach comments to exported signatures.

## TODO
- Add support for stripping type annotations in TypeScript to save even more tokens.
