## Architecture

```
project-graph-mcp/
├── src/
│   ├── server.js             # Entry point (CLI/MCP mode switch)
│   ├── mcp-server.js         # MCP server + response hints
│   ├── cli.js / cli-handlers.js  # CLI commands
│   ├── tool-defs.js          # MCP tool schemas
│   ├── tools.js              # Graph tools (skeleton, expand, deps)
│   ├── workspace.js          # Path resolution + traversal protection
│   ├── parser.js             # AST parser (Acorn) + language routing
│   ├── lang-typescript.js    # TypeScript/TSX regex parser
│   ├── lang-python.js        # Python regex parser
│   ├── lang-go.js            # Go regex parser
│   ├── lang-utils.js         # Shared: stripStringsAndComments
│   ├── graph-builder.js      # Minified graph + legend
│   ├── filters.js            # Exclude patterns, .gitignore
│   ├── dead-code.js          # Unused code detection
│   ├── complexity.js         # Cyclomatic complexity
│   ├── similar-functions.js  # Duplicate detection
│   ├── large-files.js        # File size analysis
│   ├── outdated-patterns.js  # Legacy pattern detection
│   ├── full-analysis.js      # Health Score (0-100)
│   ├── undocumented.js       # Missing JSDoc finder
│   ├── jsdoc-generator.js    # JSDoc template generation
│   ├── custom-rules.js       # Configurable lint rules
│   ├── framework-references.js # Framework-specific docs
│   ├── test-annotations.js   # @test/@expect parsing
│   └── instructions.js       # Agent guidelines
├── rules/                    # Pre-built rule sets (JSON)
├── references/               # Framework reference docs
├── vendor/
│   ├── acorn.mjs             # AST parser (MIT, vendored)
│   └── walk.mjs              # AST walker (MIT, vendored)
└── tests/
    ├── parser.test.js
    └── mcp.test.js
```
