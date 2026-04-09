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
│   ├── lang-sql.js           # SQL extraction (tables, columns)
│   ├── lang-utils.js         # Shared: stripStringsAndComments
│   ├── graph-builder.js      # Minified graph + legend
│   ├── filters.js            # Exclude patterns, .gitignore
│   ├── compress.js           # Terser minification + export legend
│   ├── compact.js            # Project-wide compact/beautify (mangle: false)
│   ├── doc-dialect.js        # Doc Dialect (.context/ format)
│   ├── ctx-to-jsdoc.js       # .ctx → JSDoc injection + stripping
│   ├── ai-context.js         # AI boot aggregator
│   ├── dead-code.js          # Unused code detection
│   ├── complexity.js         # Cyclomatic complexity
│   ├── similar-functions.js  # Duplicate detection
│   ├── large-files.js        # File size analysis
│   ├── outdated-patterns.js  # Legacy pattern detection
│   ├── full-analysis.js      # Health Score (0-100) + streaming + summary
│   ├── jsdoc-checker.js      # JSDoc ↔ AST consistency validator
│   ├── type-checker.js       # Optional tsc wrapper (async)
│   ├── analysis-cache.js     # Incremental analysis cache (.context/.cache/)
│   ├── undocumented.js       # Missing JSDoc finder
│   ├── jsdoc-generator.js    # JSDoc template generation
│   ├── custom-rules.js       # Configurable lint rules
│   ├── framework-references.js # Framework-specific docs
│   ├── test-annotations.js   # .ctx.md test checklist parsing
│   ├── db-analysis.js        # SQL schema + table usage
│   └── instructions.js       # Agent guidelines
├── rules/                    # Pre-built rule sets (JSON)
├── references/               # Framework reference docs
├── vendor/
│   ├── acorn.mjs             # AST parser (MIT, vendored)
│   ├── walk.mjs              # AST walker (MIT, vendored)
│   └── terser.mjs            # JS minifier (BSD, vendored)
└── tests/
    ├── parser.test.js
    ├── mcp.test.js
    └── compact.test.js        # Compact/beautify, ctx-to-jsdoc tests
```
