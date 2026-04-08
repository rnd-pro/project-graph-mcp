# instructions.js

## Notes
- Houses the master `AGENT_INSTRUCTIONS` string, serving as the central rulebook for AI agents operating in the project.
- Defines strict standards: Triple-File Partitioning for Symbiote.js, ESM only, and proper MCP tools usage.
- Details the comprehensive `@test`/`@expect` annotation system for verifying behavior.

## Edge Cases
- Auto-detects custom rulesets based on `package.json` dependencies and import patterns.
- Specifies severity levels (`error`, `warning`, `info`) to help agents prioritize fixes.

## Decisions
- Encapsulates rules directly as a constant string rather than a separate Markdown file to make it easily importable and injectable by the MCP server.
- Organizes test/expect annotations into categories (Browser, API, CLI, System) for clarity.

## TODO
- Potentially split the large string into a separate `.md` file that is read at runtime if it grows too large.
