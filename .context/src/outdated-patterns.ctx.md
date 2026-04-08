# outdated-patterns.js

## Notes
- Identifies legacy JS patterns and redundant npm packages that can be replaced by modern Node.js built-ins
- Flags legacy code: `var`, `require`, `module.exports`, `new Buffer()`, `arguments`, and `util.promisify`
- Flags redundant deps for Node 18+: `node-fetch`, `uuid`, `rimraf`, `mkdirp`, `glob`, etc.
- Detects synchronous filesystem methods (e.g., `readFileSync`) used inside `async` functions

## Edge Cases
- Async context tracking traverses up the AST, which means it correctly handles nested sync calls inside async arrows or callbacks
- Syntactically invalid files are skipped silently without affecting the overall analysis
- Dependency analysis relies strictly on the `package.json` in the scanned directory root and ignores hoisted dependencies in monorepos

## Decisions
- Sync-in-async detection specifically targets `*Sync` property calls to avoid false positives on standard synchronous utility functions
- Hardcoded replacement map for Node built-ins ensures the tool remains fast and doesn't require external vulnerability databases

## TODO
- Add auto-fix capabilities for simple replacements like `var` to `let`/`const`
- Extend redundant dependency list for Node 22+ (e.g., test runner built-ins)