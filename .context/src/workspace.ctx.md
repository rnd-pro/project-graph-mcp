# workspace.js

## Notes
- Manages the absolute workspace root path resolution for the server.
- Establishes priority: MCP roots > `--workspace` arg > `PROJECT_ROOT` env var > `process.cwd()`.
- Ensures all paths requested by agents are resolved relative to this root safely.

## Edge Cases
- Prevents directory traversal attacks by validating that resolved paths stay within the workspace root.
- Strips `file://` protocols commonly sent by MCP clients in root URIs.

## Decisions
- Centralized path resolution to prevent inconsistent relative path issues across different CLI and MCP contexts.
- Added strict path bounds checking as a critical security measure against rogue agent requests.

## TODO
- Support multiple independent workspace roots instead of combining into a single root.