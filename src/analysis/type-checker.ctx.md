# type-checker.js

## Notes
- Wraps the TypeScript compiler (`tsc`) to provide deep type validation using JSDoc annotations in JS files.
- Automatically falls back to `npx tsc` if a global installation isn't found.
- Returns structured diagnostics (line, column, severity, code) parsed from `tsc` output.

## Edge Cases
- Implements a 60-second timeout to kill hanging `tsc` processes to prevent runaway tasks.
- Degrades gracefully (returns an error message) if `tsc` is completely unavailable rather than crashing.

## Decisions
- Uses `tsconfig.json` or `jsconfig.json` if present, otherwise injects sensible defaults for JS projects (`--allowJs`, `--checkJs`, `--noEmit`).
- Spawns a child process rather than using TS compiler API directly to avoid a heavy `typescript` dependency.

## TODO
- Add caching for type check results to speed up repeated validations on unchanged files.
