# Contributing

`project-graph-mcp` is an MCP server for compact project graphs, code analysis, dependency context, and browser-test checklists.

Keep changes close to the owning area:

- MCP server and transport: `src/network/`
- Project graph, skeleton, and analysis behavior: `src/`
- Public docs and examples: `README.md`, `docs/`, and `CONFIGURATION.md`
- Consumer packaging checks: `scripts/consumer-test.mjs`

Before opening a change, run:

```sh
npm test
npm run test:consumer
```

Do not commit generated caches, private project graphs, local configs, private paths, credentials, or temporary audits.
