## Architecture

```
project-graph-mcp/
├── src/
│   ├── core/                    # Foundation
│   │   ├── parser.js            # AST parser (Acorn) + language routing
│   │   ├── graph-builder.js     # Minified graph + legend
│   │   ├── filters.js           # Exclude patterns, .gitignore
│   │   ├── workspace.js         # Path resolution + traversal protection
│   │   └── event-bus.js         # Tool call/result events for web UI
│   ├── analysis/                # Code quality analysis
│   │   ├── dead-code.js         # Unused code detection
│   │   ├── complexity.js        # Cyclomatic complexity
│   │   ├── similar-functions.js # Duplicate detection
│   │   ├── large-files.js       # File size analysis
│   │   ├── outdated-patterns.js # Legacy pattern detection
│   │   ├── full-analysis.js     # Health Score (0–100) + streaming + summary
│   │   ├── jsdoc-checker.js     # JSDoc ↔ AST consistency validator
│   │   ├── jsdoc-generator.js   # JSDoc template generation
│   │   ├── type-checker.js      # Optional tsc wrapper (async)
│   │   ├── undocumented.js      # Missing JSDoc finder
│   │   ├── custom-rules.js      # Configurable lint rules
│   │   ├── test-annotations.js  # .ctx.md test checklist parsing
│   │   ├── db-analysis.js       # SQL schema + table usage
│   │   └── analysis-cache.js    # Incremental cache (.context/.cache/)
│   ├── compact/                 # AI context compression
│   │   ├── compress.js          # Terser minification + export legend
│   │   ├── compact.js           # Project-wide compact/beautify (mangle: false)
│   │   ├── expand.js            # Decompile: name restoration from .ctx
│   │   ├── doc-dialect.js       # Doc Dialect (.context/ format)
│   │   ├── ctx-to-jsdoc.js      # .ctx → JSDoc injection + stripping
│   │   ├── ai-context.js        # AI boot aggregator
│   │   ├── mode-config.js       # Compact mode config (1/2/3/4)
│   │   ├── validate-pipeline.js # .ctx ↔ source contract validation
│   │   ├── framework-references.js # Framework-specific docs
│   │   └── instructions.js      # Agent guidelines
│   ├── lang/                    # Multi-language parsers
│   │   ├── lang-typescript.js   # TypeScript/TSX regex parser
│   │   ├── lang-python.js       # Python regex parser
│   │   ├── lang-go.js           # Go regex parser
│   │   ├── lang-sql.js          # SQL extraction (tables, columns)
│   │   └── lang-utils.js        # Shared: stripStringsAndComments
│   ├── cli/                     # CLI interface
│   │   ├── cli.js               # CLI entry point + help
│   │   └── cli-handlers.js      # CLI command handlers
│   ├── mcp/                     # MCP protocol
│   │   ├── mcp-server.js        # MCP server + response hints
│   │   ├── tool-defs.js         # MCP tool schemas (18 grouped tools)
│   │   └── tools.js             # Graph tools (skeleton, expand, deps)
│   └── network/                 # Server & networking
│       ├── server.js            # Entry point (CLI/MCP/Serve mode switch)
│       ├── backend.js           # Background backend process
│       ├── backend-lifecycle.js # Port file management + stdio proxy
│       ├── web-server.js        # HTTP + WebSocket server for web UI
│       ├── local-gateway.js     # Multi-project gateway registry
│       └── mdns.js              # mDNS/DNS-SD service advertisement
├── web/                         # Web dashboard
│   ├── index.html / dashboard.html
│   ├── app.js / dashboard.js    # Application entry points
│   ├── state.js                 # WebSocket state management
│   └── panels/                  # UI components (Symbiote.js)
├── rules/                       # Pre-built rule sets (JSON)
├── vendor/
│   ├── acorn.mjs                # AST parser (MIT, vendored)
│   ├── walk.mjs                 # AST walker (MIT, vendored)
│   └── terser.mjs               # JS minifier (BSD, vendored)
├── tests/
│   ├── parser.test.js           # AST parser + graph builder
│   ├── mcp.test.js              # MCP tool integration
│   ├── compact.test.js          # Compact/beautify, ctx-to-jsdoc
│   ├── consolidated.test.js     # Analysis tools tests
│   └── orm.test.js              # ORM/SQL test cases
├── docs/                        # Public documentation
│   ├── ROADMAP.md
│   ├── examples/                # AGENT_ROLE templates
│   └── references/              # Framework reference docs
└── dev-docs/                    # Internal R&D (not public)
    ├── ideas/                   # Feature research & design docs
    └── prototypes/              # Experimental code
```
