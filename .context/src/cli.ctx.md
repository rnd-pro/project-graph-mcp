# cli.js

## Notes
- The command-line entry point when running `npx project-graph-mcp <command>`.
- Displays usage help and acts as a router, mapping CLI commands to their respective handlers.
- Separated from the MCP server to provide direct terminal access to graph tools.

## Edge Cases
- Fails process with `exit(1)` and error message if required arguments are missing.
- Handles both formatted JSON output and raw string output depending on the command definition.

## Decisions
- Extracted handlers into `cli-handlers.js` to keep the entry file purely focused on routing and stdout.
- Used a simple array/dictionary approach for commands instead of heavy CLI frameworks like Commander.

## TODO
- Add support for piping stdin directly into certain commands.