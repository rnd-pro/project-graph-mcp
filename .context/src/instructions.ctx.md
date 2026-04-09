# instructions.js

## Notes
- Houses the master `AGENT_INSTRUCTIONS` string, serving as the central rulebook for AI agents operating in the project.
- Defines strict standards: Triple-File Partitioning for Symbiote.js, ESM only, and proper MCP tools usage.
- Details testing workflow via `.ctx.md` file-based checklists (`get_pending_tests`).

## Edge Cases
- Auto-detects custom rulesets based on `package.json` dependencies and import patterns.
- Specifies severity levels (`error`, `warning`, `info`) to help agents prioritize fixes.

## Decisions
- Encapsulates rules directly as a constant string rather than a separate Markdown file to make it easily importable and injectable by the MCP server.
- Organizes agent guidelines into clear categories (coding, testing, quality) for structured reasoning.

## TODO
- Potentially split the large string into a separate `.md` file that is read at runtime if it grows too large.
