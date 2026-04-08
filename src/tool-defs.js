/**
 * MCP Tool Definitions
 */

export const TOOLS = [
  // Graph Tools
  {
    name: 'get_skeleton',
    description: 'Get compact minified project overview (10-50x smaller than source). Returns legend, stats, and node summaries.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to scan (e.g., "src/components")',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'get_focus_zone',
    description: 'Get enriched context for recently modified files. Auto-detects from git or accepts explicit file list.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        recentFiles: {
          type: 'array',
          items: { type: 'string' },
          description: 'Explicit list of files to expand',
        },
        useGitDiff: {
          type: 'boolean',
          description: 'Auto-detect from git diff',
        },
      },
    },
  },
  {
    name: 'expand',
    description: 'Expand a minified symbol to full details. Use "SN" for class or "SN.tP" for specific method.',
    inputSchema: {
      type: 'object',
      properties: {
        symbol: {
          type: 'string',
          description: 'Minified symbol (e.g., "SN" or "SN.tP")',
        },
      },
      required: ['symbol'],
    },
  },
  {
    name: 'deps',
    description: 'Get dependency tree for a symbol. Shows imports, usedBy, and calls.',
    inputSchema: {
      type: 'object',
      properties: {
        symbol: { type: 'string' },
      },
      required: ['symbol'],
    },
  },
  {
    name: 'usages',
    description: 'Find all usages of a symbol across the project.',
    inputSchema: {
      type: 'object',
      properties: {
        symbol: { type: 'string' },
      },
      required: ['symbol'],
    },
  },
  {
    name: 'get_call_chain',
    description: 'Find the shortest call chain from one function/class to another through the dependency graph.',
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Starting symbol (e.g., "authMiddleware")' },
        to: { type: 'string', description: 'Target symbol (e.g., "renderDashboard")' },
        path: { type: 'string', description: 'Path to scan (optional)' }
      },
      required: ['from', 'to'],
    },
  },
  {
    name: 'invalidate_cache',
    description: 'Invalidate the cached graph. Use after making code changes.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },

  // Test Checklist Tools
  {
    name: 'get_pending_tests',
    description: 'Get list of pending tests from ## Tests sections in .ctx.md files.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to scan (e.g., "src/components")' },
      },
      required: ['path'],
    },
  },
  {
    name: 'mark_test_passed',
    description: 'Mark a test step as passed. Use the test ID returned by get_pending_tests.',
    inputSchema: {
      type: 'object',
      properties: {
        testId: { type: 'string', description: 'Test ID (e.g., "togglePin.0")' },
      },
      required: ['testId'],
    },
  },
  {
    name: 'mark_test_failed',
    description: 'Mark a test step as failed with a reason.',
    inputSchema: {
      type: 'object',
      properties: {
        testId: { type: 'string' },
        reason: { type: 'string', description: 'Why the test failed' },
      },
      required: ['testId', 'reason'],
    },
  },
  {
    name: 'get_test_summary',
    description: 'Get summary of test progress: passed, failed, pending counts.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
      },
      required: ['path'],
    },
  },
  {
    name: 'reset_test_state',
    description: 'Reset all test progress to start fresh.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },

  // Filter Configuration Tools
  {
    name: 'get_filters',
    description: 'Get current filter configuration (excluded dirs, patterns, gitignore status).',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'set_filters',
    description: 'Update filter configuration. Pass only fields you want to change.',
    inputSchema: {
      type: 'object',
      properties: {
        excludeDirs: {
          type: 'array',
          items: { type: 'string' },
          description: 'Directories to exclude (replaces current list)',
        },
        excludePatterns: {
          type: 'array',
          items: { type: 'string' },
          description: 'File patterns to exclude (e.g., "*.test.js")',
        },
        includeHidden: {
          type: 'boolean',
          description: 'Include hidden directories (starting with .)',
        },
        useGitignore: {
          type: 'boolean',
          description: 'Parse and use .gitignore patterns',
        },
      },
    },
  },
  {
    name: 'add_excludes',
    description: 'Add directories to exclude list without replacing.',
    inputSchema: {
      type: 'object',
      properties: {
        dirs: {
          type: 'array',
          items: { type: 'string' },
          description: 'Directories to add to exclude list',
        },
      },
      required: ['dirs'],
    },
  },
  {
    name: 'remove_excludes',
    description: 'Remove directories from exclude list.',
    inputSchema: {
      type: 'object',
      properties: {
        dirs: {
          type: 'array',
          items: { type: 'string' },
          description: 'Directories to remove from exclude list',
        },
      },
      required: ['dirs'],
    },
  },
  {
    name: 'reset_filters',
    description: 'Reset filters to default configuration.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },

  // Guidelines
  {
    name: 'get_usage_guide',
    description: [
      'Get the comprehensive usage guide for project-graph with examples and best practices.',
      'Call this FIRST when planning how to analyze, navigate, or audit a codebase.',
      'Returns practical examples and recommended workflow for each feature area.',
      '',
      'Available topics: navigation, analysis, testing, documentation, rules, workflow.',
      'Omit topic to get the full guide.',
    ].join('\n'),
    inputSchema: {
      type: 'object',
      properties: {
        topic: {
          type: 'string',
          description: 'Optional topic filter: navigation, analysis, testing, documentation, rules, workflow',
        },
      },
    },
  },
  {
    name: 'get_agent_instructions',
    description: 'Get coding guidelines, architectural standards, and JSDoc rules for this project.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },

  // Documentation Analysis
  {
    name: 'get_undocumented',
    description: 'Find classes/functions missing JSDoc annotations. Use for documentation generation.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to scan (e.g., "src/components")',
        },
        level: {
          type: 'string',
          enum: ['tests', 'params', 'all'],
          description: 'Strictness: tests (default) = .ctx.md checklists, params = +@param/@returns, all = +description',
        },
      },
      required: ['path'],
    },
  },

  // Code Quality
  {
    name: 'get_dead_code',
    description: 'Find unused functions, classes, exports, variables, and imports (dead code). Use for cleanup.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to scan (e.g., "src/")',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'generate_jsdoc',
    description: 'Generate JSDoc template for a file or specific function. Returns ready-to-use JSDoc blocks.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to JS file',
        },
        name: {
          type: 'string',
          description: 'Optional: specific function/method name',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'get_similar_functions',
    description: 'Find functionally similar functions (potential duplicates). Returns pairs with similarity score.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to scan (e.g., "src/")',
        },
        threshold: {
          type: 'number',
          description: 'Minimum similarity percentage (default: 60)',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'get_complexity',
    description: 'Analyze cyclomatic complexity of functions. Identifies high-complexity code needing refactoring.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to scan (e.g., "src/")',
        },
        minComplexity: {
          type: 'number',
          description: 'Minimum complexity to include (default: 1)',
        },
        onlyProblematic: {
          type: 'boolean',
          description: 'Only show high/critical items',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'get_large_files',
    description: 'Find files that may need splitting. Analyzes lines, functions, classes, and exports.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to scan (e.g., "src/")',
        },
        onlyProblematic: {
          type: 'boolean',
          description: 'Only show warning/critical files',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'get_outdated_patterns',
    description: 'Find legacy code patterns and redundant npm dependencies (now built into Node.js 18+).',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to scan (e.g., "src/" or ".")',
        },
        codeOnly: {
          type: 'boolean',
          description: 'Only check code patterns',
        },
        depsOnly: {
          type: 'boolean',
          description: 'Only check package.json dependencies',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'get_full_analysis',
    description: 'Run ALL code quality checks at once. Returns combined report with Health Score (0-100).',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to scan (e.g., "src/" or ".")',
        },
        includeItems: {
          type: 'boolean',
          description: 'Include individual items in report',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'get_custom_rules',
    description: 'List all custom code analysis rules. Rules are stored in JSON files in rules/ directory.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'set_custom_rule',
    description: 'Add or update a custom code analysis rule. Creates ruleset if it does not exist.',
    inputSchema: {
      type: 'object',
      properties: {
        ruleSet: {
          type: 'string',
          description: 'Name of ruleset (e.g., "symbiote", "react", "custom")',
        },
        rule: {
          type: 'object',
          description: 'Rule definition with id, name, description, pattern, patternType, replacement, severity, filePattern',
        },
      },
      required: ['ruleSet', 'rule'],
    },
  },
  {
    name: 'check_custom_rules',
    description: 'Run custom rules analysis on a directory. Returns violations found.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to scan',
        },
        ruleSet: {
          type: 'string',
          description: 'Optional: specific ruleset to use',
        },
        severity: {
          type: 'string',
          description: 'Optional: filter by severity (error/warning/info)',
        },
      },
      required: ['path'],
    },
  },

  // Framework References
  {
    name: 'get_framework_reference',
    description: 'Get framework-specific AI reference documentation. Auto-detects framework from project or accepts explicit name. Returns full API reference, patterns, and common mistakes as agent context.',
    inputSchema: {
      type: 'object',
      properties: {
        framework: {
          type: 'string',
          description: 'Framework reference name (e.g., "symbiote-3x"). If omitted, auto-detects from path.',
        },
        path: {
          type: 'string',
          description: 'Project path for auto-detection (e.g., "src/")',
        },
      },
    },
  },

  // Database Analysis
  {
    name: 'get_db_schema',
    description: 'Get database schema from SQL files. Extracts tables, columns, and types from schema.sql or migration files in the project.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to scan (e.g., "." or "database/")',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'get_table_usage',
    description: 'Show which functions read/write database tables. Traces SQL queries in JS/TS/Python/Go code to table references.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to scan (e.g., "src/")',
        },
        table: {
          type: 'string',
          description: 'Optional: filter to a specific table name',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'get_db_dead_tables',
    description: 'Find tables and columns defined in schema but never referenced in code queries. Requires .sql schema files in the project.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to scan (e.g., ".")',
        },
      },
      required: ['path'],
    },
  },

  // AI Context Tools
  {
    name: 'get_compressed_file',
    description: 'Get AI-optimized compressed version of a JS source file. Terser-minified with export legend. Saves 20-55% tokens (more with heavy JSDoc).',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to JS/MJS file',
        },
        beautify: {
          type: 'boolean',
          description: 'Readable multi-line output (default: true). Set false for maximum compression.',
        },
        legend: {
          type: 'boolean',
          description: 'Include compact export legend header (default: true)',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'get_project_docs',
    description: 'Get compact project documentation in doc-dialect format. Returns architecture, patterns, edge cases. Merges auto-generated docs with manual .context/ files.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Project root path',
        },
        file: {
          type: 'string',
          description: 'Optional: get docs for a specific file only',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'generate_context_docs',
    description: 'Generate .context/ doc-dialect files from AST. Creates rich templates with {DESCRIBE} markers. Use agent-pool with doc-enricher skill to auto-fill descriptions. Templates include function signatures, call graphs, and DB access patterns extracted from AST.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Project root path',
        },
        overwrite: {
          type: 'boolean',
          description: 'Overwrite existing .ctx files (default: false). Existing descriptions are preserved via merge.',
        },
        scope: {
          description: 'Scope filter: "all" (default), "focus" (git diff — recently changed files only), or array of specific file paths.',
          oneOf: [
            { type: 'string', enum: ['all', 'focus'] },
            { type: 'array', items: { type: 'string' } },
          ],
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'check_stale_docs',
    description: 'Check which .ctx documentation files are outdated. Compares AST signature hashes to detect structural changes (new functions, renamed exports). Use for CI/CD doc health audits.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Project root path',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'get_ai_context',
    description: 'Boot AI agent context: skeleton + doc-dialect + optional compressed files in one call. Call FIRST when starting work on a new project. Returns totalTokens and savings vs reading raw source.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Project root path',
        },
        includeFiles: {
          type: 'array',
          items: { type: 'string' },
          description: 'Specific files to include compressed (e.g., ["parser.js", "tools.js"])',
        },
        includeDocs: {
          type: 'boolean',
          description: 'Include doc-dialect documentation (default: true)',
        },
        includeSkeleton: {
          type: 'boolean',
          description: 'Include project skeleton (default: true)',
        },
      },
      required: ['path'],
    },
  },

  // JSDoc Consistency
  {
    name: 'check_jsdoc_consistency',
    description: 'Validate JSDoc annotations against actual function signatures. Finds param count/name mismatches, missing @returns, type inconsistencies.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to scan (e.g., "src/")',
        },
      },
      required: ['path'],
    },
  },

  // Type Checker (optional tsc)
  {
    name: 'check_types',
    description: 'Run TypeScript type checking on JS files with JSDoc types. Requires tsc in PATH (npm i -g typescript). Returns structured diagnostics or graceful fallback if tsc not available.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Directory to check',
        },
        files: {
          type: 'array',
          items: { type: 'string' },
          description: 'Specific files to check (optional)',
        },
        maxDiagnostics: {
          type: 'number',
          description: 'Max diagnostics to return (default: 50)',
        },
      },
      required: ['path'],
    },
  },
];
