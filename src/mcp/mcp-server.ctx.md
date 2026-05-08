# mcp-server.js

## Notes
- The core MCP (Model Context Protocol) server handling bidirectional JSON-RPC 2.0 over stdio.
- Maps incoming `tools/call` requests to the business logic handlers defined in `tools.js`, `filters.js`, etc.
- Injects helpful, contextual hints (`RESPONSE_HINTS`) into tool outputs to guide the AI agent.

## Edge Cases
- Dynamically requests `roots/list` from the client to auto-detect the workspace root if the client supports it.
- Handles unexpected tool exceptions by returning properly formatted JSON-RPC error objects.

## Decisions
- Separated `mcp-server.js` from individual tool logic to decouple the RPC protocol layer from graph operations.
- Used contextual coaching hints to improve autonomous agent workflows without changing raw tool output.

## TODO
- Add support for SSE (Server-Sent Events) or other MCP transports.