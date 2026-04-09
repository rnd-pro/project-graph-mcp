import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { TOOLS } from './tool-defs.js';
import { getSkeleton, getFocusZone, expand, deps, usages, invalidateCache, getCallChain } from './tools.js';
import { getPendingTests, markTestPassed, markTestFailed, getTestSummary, resetTestState } from './test-annotations.js';
import { getFilters, setFilters, addExcludes, removeExcludes, resetFilters } from './filters.js';
import { getInstructions } from './instructions.js';
import { getUndocumentedSummary } from './undocumented.js';
import { getDeadCode } from './dead-code.js';
import { generateJSDoc, generateJSDocFor } from './jsdoc-generator.js';
import { getSimilarFunctions } from './similar-functions.js';
import { getComplexity } from './complexity.js';
import { getLargeFiles } from './large-files.js';
import { getOutdatedPatterns } from './outdated-patterns.js';
import { getFullAnalysis, getAnalysisSummaryOnly } from './full-analysis.js';
import { getCustomRules, setCustomRule, checkCustomRules } from './custom-rules.js';
import { getFrameworkReference } from './framework-references.js';
import { setRoots, resolvePath } from './workspace.js';
import { getDBSchema, getTableUsage, getDBDeadTables } from './db-analysis.js';
import { compressFile, editCompressed } from './compress.js';
import { getProjectDocs, generateContextFiles, checkStaleness } from './doc-dialect.js';
import { getGraph } from './tools.js';
import { parseProject, discoverSubProjects } from './parser.js';
import { getAiContext } from './ai-context.js';
import { checkJSDocConsistency } from './jsdoc-checker.js';
import { checkTypes } from './type-checker.js';
import { compactProject, expandProject } from './compact.js';
import { validateCtxContracts } from './ctx-to-jsdoc.js';
import { getConfig, setConfig, getModeDescription, getModeWorkflow } from './mode-config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TOOL_HANDLERS = {
  // Graph Tools
  get_skeleton: (args) => getSkeleton(resolvePath(args.path)),
  get_focus_zone: (args) => getFocusZone({ ...args, path: resolvePath(args.path) }),
  expand: (args) => expand(args.symbol),
  deps: (args) => deps(args.symbol),
  usages: (args) => usages(args.symbol),
  get_call_chain: (args) => getCallChain({ from: args.from, to: args.to, path: args.path ? resolvePath(args.path) : undefined }),
  invalidate_cache: () => { invalidateCache(); return { success: true }; },

  // Test Checklist Tools
  get_pending_tests: (args) => getPendingTests(resolvePath(args.path)),
  mark_test_passed: (args) => markTestPassed(args.testId),
  mark_test_failed: (args) => markTestFailed(args.testId, args.reason),
  get_test_summary: (args) => getTestSummary(resolvePath(args.path)),
  reset_test_state: () => resetTestState(),

  // Filter Tools
  get_filters: () => getFilters(),
  set_filters: (args) => setFilters(args),
  add_excludes: (args) => addExcludes(args.dirs),
  remove_excludes: (args) => removeExcludes(args.dirs),
  reset_filters: () => resetFilters(),

  // Guidelines
  get_usage_guide: (args) => {
    try {
      const guidePath = path.join(__dirname, '..', 'GUIDE.md');
      const content = fs.readFileSync(guidePath, 'utf8');
      if (!args.topic) return content;
      const regex = new RegExp(`## ${args.topic}`, 'i');
      const match = content.match(regex);
      if (!match) return `Topic '${args.topic}' not found in guide.`;
      const start = match.index;
      let end = content.indexOf('\n## ', start + 1);
      if (end === -1) end = content.length;
      return content.substring(start, end).trim();
    } catch (e) {
      return `Failed to read usage guide: ${e.message}`;
    }
  },
  get_agent_instructions: () => getInstructions(),

  // Documentation
  get_undocumented: (args) => getUndocumentedSummary(resolvePath(args.path), args.level || 'tests'),

  // Code Quality
  get_dead_code: (args) => getDeadCode(resolvePath(args.path)),
  generate_jsdoc: (args) => args.name
    ? generateJSDocFor(resolvePath(args.path), args.name)
    : generateJSDoc(resolvePath(args.path)),
  get_similar_functions: (args) => getSimilarFunctions(resolvePath(args.path), { threshold: args.threshold }),
  get_complexity: (args) => getComplexity(resolvePath(args.path), {
    minComplexity: args.minComplexity,
    onlyProblematic: args.onlyProblematic,
  }),
  get_large_files: (args) => getLargeFiles(resolvePath(args.path), { onlyProblematic: args.onlyProblematic }),
  get_outdated_patterns: (args) => getOutdatedPatterns(resolvePath(args.path), {
    codeOnly: args.codeOnly,
    depsOnly: args.depsOnly,
  }),
  get_full_analysis: (args) => getFullAnalysis(resolvePath(args.path), { includeItems: args.includeItems }),

  // Custom Rules
  get_custom_rules: () => getCustomRules(),
  set_custom_rule: (args) => setCustomRule(args.ruleSet, args.rule),
  check_custom_rules: (args) => checkCustomRules(resolvePath(args.path), {
    ruleSet: args.ruleSet,
    severity: args.severity,
  }),

  // Framework References
  get_framework_reference: (args) => getFrameworkReference({
    framework: args.framework,
    path: args.path ? resolvePath(args.path) : undefined,
  }),

  // Database Analysis
  get_db_schema: (args) => getDBSchema(resolvePath(args.path)),
  get_table_usage: (args) => getTableUsage(resolvePath(args.path), args.table),
  get_db_dead_tables: (args) => getDBDeadTables(resolvePath(args.path)),

  // AI Context
  get_compressed_file: (args) => compressFile(resolvePath(args.path), {
    beautify: args.beautify,
    legend: args.legend,
  }),
  get_project_docs: async (args) => {
    const projectPath = resolvePath(args.path);
    const graph = await getGraph(projectPath);
    const docs = getProjectDocs(graph, projectPath, { file: args.file });
    // Lazy staleness check — wrapped in try-catch for projects with parse errors
    try {
      const parsed = await parseProject(projectPath);
      const staleness = checkStaleness(projectPath, parsed);
      return { docs, staleFiles: staleness.stale, freshCount: staleness.fresh };
    } catch { return { docs }; }
  },
  generate_context_docs: async (args) => {
    const projectPath = resolvePath(args.path);
    const graph = await getGraph(projectPath);
    const parsed = await parseProject(projectPath);
    return generateContextFiles(graph, projectPath, parsed, {
      overwrite: args.overwrite,
      scope: args.scope,
    });
  },
  check_stale_docs: async (args) => {
    const projectPath = resolvePath(args.path);
    const parsed = await parseProject(projectPath);
    return checkStaleness(projectPath, parsed);
  },
  get_ai_context: async (args) => {
    const projectPath = resolvePath(args.path);
    const result = await getAiContext(projectPath, {
      includeFiles: args.includeFiles,
      includeDocs: args.includeDocs,
      includeSkeleton: args.includeSkeleton,
    });
    // Add staleness info
    try {
      const parsed = await parseProject(projectPath);
      const staleness = checkStaleness(projectPath, parsed);
      result.staleFiles = staleness.stale;
    } catch { /* parse error — skip staleness */ }
    return result;
  },

  // JSDoc Consistency
  check_jsdoc_consistency: (args) => {
    return checkJSDocConsistency(resolvePath(args.path));
  },

  // Type Checker (optional tsc)
  check_types: async (args) => {
    return checkTypes(resolvePath(args.path), {
      files: args.files,
      maxDiagnostics: args.maxDiagnostics,
    });
  },

  // Monorepo & Performance
  discover_sub_projects: (args) => {
    return discoverSubProjects(resolvePath(args.path));
  },
  get_analysis_summary: (args) => {
    return getAnalysisSummaryOnly(resolvePath(args.path));
  },
  compact_project: (args) => {
    return compactProject(resolvePath(args.path), { dryRun: args.dryRun || false });
  },
  beautify_project: (args) => {
    return expandProject(resolvePath(args.path), { dryRun: args.dryRun || false });
  },
  validate_ctx_contracts: (args) => {
    return validateCtxContracts(resolvePath(args.path), { strict: args.strict || false });
  },
  edit_compressed: (args) => {
    return editCompressed(resolvePath(args.path), args.symbol, args.code, {
      beautify: args.beautify !== false,
      dryRun: args.dryRun || false,
    });
  },
  get_mode: (args) => {
    const dir = resolvePath(args.path);
    const config = getConfig(dir);
    return {
      ...config,
      description: getModeDescription(config.mode),
      workflow: getModeWorkflow(config.mode),
    };
  },
  set_mode: (args) => {
    const dir = resolvePath(args.path);
    const updates = { mode: args.mode };
    if (args.beautify !== undefined) updates.beautify = args.beautify;
    if (args.autoValidate !== undefined) updates.autoValidate = args.autoValidate;
    if (args.stripJSDoc !== undefined) updates.stripJSDoc = args.stripJSDoc;
    return setConfig(dir, updates);
  },
};

const RESPONSE_HINTS = {
  get_skeleton: () => [
    '💡 Use expand("SYMBOL") to see code for a specific class.',
    '💡 Use deps("SYMBOL") to see architecture dependencies.',
    '💡 After code changes, run invalidate_cache() to refresh the graph.',
  ],

  expand: (result) => {
    const hints = [];
    if (result.methods?.length > 10) {
      hints.push('💡 Large class detected. Run get_complexity() to find refactoring targets.');
    }
    hints.push('💡 Use deps() to see what depends on this symbol.');
    // Nudge: document if no .ctx exists
    if (result.file) {
      hints.push(`📝 No .ctx for ${result.file}? Run generate_context_docs({ scope: ["${result.file}"] }) to create documentation.`);
    }
    return hints;
  },

  deps: () => [
    '💡 Use usages() for cross-project reference search.',
  ],

  get_call_chain: (result) => {
    if (result.error) return [];
    return [
      '💡 Use expand() on intermediate steps to understand how data is passed along the chain.',
    ];
  },

  invalidate_cache: () => [
    '✅ Cache cleared. Run get_skeleton() to rebuild the project graph.',
  ],

  get_dead_code: (result) => {
    const hints = ['💡 Review each item before removing — some may be used dynamically.'];
    if (result.unusedExports?.length > 20) {
      hints.push('💡 Consider delegating cleanup to agent-pool: delegate_task({ prompt: "Remove dead code..." })');
    }
    return hints;
  },

  get_full_analysis: () => [
    '💡 Focus on items with "critical" severity first.',
    '💡 Run individual tools (get_complexity, get_dead_code) for detailed breakdowns.',
  ],

  get_complexity: () => [
    '💡 Functions with complexity >10 are candidates for refactoring.',
    '💡 Use expand() to read the function code before refactoring.',
  ],

  get_undocumented: () => [
    '💡 Use generate_jsdoc() to auto-generate documentation templates.',
  ],

  get_similar_functions: () => [
    '💡 Consider extracting duplicated logic into a shared utility.',
  ],

  get_pending_tests: () => [
    '💡 Use mark_test_passed(testId) or mark_test_failed(testId, reason) to track progress.',
  ],

  get_db_schema: (result) => {
    const hints = [];
    if (result.totalTables > 0) {
      hints.push(`💡 Found ${result.totalTables} tables. Use get_table_usage() to see which code reads/writes them.`);
    } else {
      hints.push('💡 No .sql schema files found. Add schema.sql or migrations/*.sql to your project.');
    }
    return hints;
  },

  get_table_usage: (result) => {
    const hints = ['💡 Use get_db_dead_tables() to find tables defined in schema but never queried.'];
    if (result.totalTables === 0) {
      hints.push('💡 No SQL queries detected. This tool finds SQL in .query(), .execute(), sql`...` patterns.');
    }
    return hints;
  },

  get_db_dead_tables: () => [
    '💡 Dead columns detection is best-effort — verify before removing.',
  ],

  get_compressed_file: (result) => {
    const hints = [`💡 Saved ${result.savings} tokens (${result.original} → ${result.compressed}).`];
    hints.push('💡 Use get_ai_context() for full project boot: skeleton + docs + compressed files.');
    if (result.file) {
      hints.push(`📝 Working on ${result.file}? Run generate_context_docs({ scope: ["${result.file}"] }) to document it.`);
    }
    return hints;
  },

  get_project_docs: (result) => {
    const hints = [
      '💡 Enrich docs by editing .context/*.ctx files — they are git-tracked.',
      '💡 Use generate_context_docs() to create initial .ctx stubs.',
    ];
    if (result.staleFiles?.length > 0) {
      hints.push(`⚠️ ${result.staleFiles.length} .ctx files are STALE: ${result.staleFiles.slice(0, 5).join(', ')}. Run generate_context_docs({ scope: ${JSON.stringify(result.staleFiles)}, overwrite: true }) to update (descriptions will be preserved).`);
    }
    return hints;
  },

  check_stale_docs: (result) => {
    const hints = [];
    if (result.stale?.length > 0) {
      hints.push(`⚠️ ${result.stale.length} stale: ${result.stale.join(', ')}`);
      hints.push(`💡 Run generate_context_docs({ scope: ${JSON.stringify(result.stale)}, overwrite: true }) — existing descriptions will be preserved.`);
    } else {
      hints.push('✅ All .ctx docs are up to date.');
    }
    if (result.unknown > 0) {
      hints.push(`ℹ️ ${result.unknown} .ctx files without @sig header (pre-staleness format).`);
    }
    return hints;
  },

  generate_context_docs: (result) => {
    const hints = [];
    if (result.created?.length > 0) {
      hints.push(`✅ Created ${result.created.length} .ctx files with @sig hashes.`);
    }
    if (result.skipped?.length > 0) {
      hints.push(`ℹ️ Skipped ${result.skipped.length} existing files. Use overwrite=true to regenerate (descriptions are preserved via merge).`);
    }
    if (result.templates && Object.keys(result.templates).length > 0) {
      hints.push(`📝 .ctx files have {DESCRIBE} markers. To enrich automatically:`);
      hints.push(`   delegate_task({ prompt: "Enrich .context/*.ctx files — replace {DESCRIBE} with compact descriptions", skill: "doc-enricher" })`);
      hints.push(`   Or enrich manually: read source files and replace {DESCRIBE} markers with pipe-separated descriptions (max 80 chars).`);
    }
    return hints;
  },

  get_ai_context: (result) => {
    const hints = [`💡 Context loaded: ${result.totalTokens} tokens (${result.savings} savings vs ${result.vsOriginal} original).`];
    hints.push('💡 Use expand() to drill into specific symbols. Use get_compressed_file() for additional files.');
    hints.push('📋 Read .context/*.ctx files for typed signatures and documentation. Check .gemini/AGENTS.md for project-specific rules.');
    if (result.staleFiles?.length > 0) {
      hints.push(`⚠️ ${result.staleFiles.length} .ctx docs are stale. Run generate_context_docs({ scope: ${JSON.stringify(result.staleFiles)}, overwrite: true }) then delegate_task({ skill: "doc-enricher" }) to update.`);
    }
    return hints;
  },

  validate_ctx_contracts: (result) => {
    const hints = [];
    if (result.summary?.errors > 0) {
      hints.push(`⚠️ ${result.summary.errors} contract violations found. Run generate_context_docs({ overwrite: true }) to regenerate .ctx files.`);
    } else {
      hints.push('✅ All .ctx contracts valid — documentation matches source.');
    }
    return hints;
  },

  edit_compressed: (result) => {
    const hints = [];
    if (result.success) {
      hints.push(`✅ Symbol "${result.symbol}" replaced in ${result.file}.`);
      hints.push('💡 Run invalidate_cache() to refresh the graph after editing.');
      hints.push('💡 Run validate_ctx_contracts() to check if .ctx docs need updating.');
    }
    return hints;
  },

  get_mode: (result) => {
    const hints = [`📋 Current mode: ${result.mode} — ${result.description}`];
    if (result.mode === 2) {
      hints.push('💡 Workflow: get_compressed_file() → read → edit_compressed() → write.');
    }
    return hints;
  },

  set_mode: (result) => {
    if (result.saved) {
      return [`✅ Mode set to ${result.config.mode}. Saved to ${result.path}.`];
    }
    return [];
  },
};

export function createServer(sendToClient) {
  let nextRequestId = 1;

    const pendingRequests = new Map();

    let clientSupportsRoots = false;

  return {
    pendingRequests,

        async handleMessage(message) {
      // Check if this is a response to our server→client request
      if (message.result !== undefined || message.error !== undefined) {
        const pending = pendingRequests.get(message.id);
        if (pending) {
          pendingRequests.delete(message.id);
          if (message.error) {
            pending.reject(new Error(message.error.message));
          } else {
            pending.resolve(message.result);
          }
        }
        return null;
      }

      const { method, params, id } = message;

      // Notification (no id) — handle but don't respond
      if (id === undefined) {
        await this.handleNotification(method, params);
        return null;
      }

      // Request — handle and respond
      try {
        switch (method) {
          case 'initialize':
            // Track client capabilities
            if (params?.capabilities?.roots) {
              clientSupportsRoots = true;
            }
            // Also check for inline roots
            if (params?.roots) {
              setRoots(params.roots);
            }
            return {
              jsonrpc: '2.0',
              id,
              result: {
                protocolVersion: '2024-11-05',
                capabilities: { tools: {}, resources: {} },
                serverInfo: { name: 'project-graph', version: '1.1.0' },
              },
            };

          case 'resources/list':
            return {
              jsonrpc: '2.0',
              id,
              result: {
                resources: [
                  {
                    uri: 'project-graph://guide',
                    name: 'Project Graph Usage Guide',
                    description: 'Comprehensive guide with workflows and examples',
                    mimeType: 'text/markdown',
                  },
                ],
              },
            };

          case 'resources/read': {
            if (params.uri !== 'project-graph://guide') {
              return { jsonrpc: '2.0', id, error: { code: -32602, message: `Resource not found: ${params.uri}` } };
            }
            const content = fs.readFileSync(path.join(__dirname, '..', 'GUIDE.md'), 'utf8');
            return {
              jsonrpc: '2.0',
              id,
              result: {
                contents: [
                  {
                    uri: 'project-graph://guide',
                    mimeType: 'text/markdown',
                    text: content,
                  },
                ],
              },
            };
          }

          case 'tools/list':
            return { jsonrpc: '2.0', id, result: { tools: TOOLS } };

          case 'tools/call': {
            const result = await this.executeTool(params.name, params.arguments);
            const content = [{ type: 'text', text: JSON.stringify(result, null, 2) }];

            // Inject contextual hints
            const hintFn = RESPONSE_HINTS[params.name];
            if (hintFn) {
              const hints = hintFn(result);
              if (hints.length > 0) {
                content.push({ type: 'text', text: '\n' + hints.join('\n') });
              }
            }

            return {
              jsonrpc: '2.0',
              id,
              result: { content },
            };
          }

          default:
            return {
              jsonrpc: '2.0',
              id,
              error: { code: -32601, message: `Method not found: ${method}` },
            };
        }
      } catch (error) {
        return { jsonrpc: '2.0', id, error: { code: -32000, message: error.message } };
      }
    },

        async handleNotification(method, params) {
      switch (method) {
        case 'notifications/initialized':
          // Client is ready — request workspace roots if supported
          if (clientSupportsRoots) {
            try {
              const roots = await this.requestRoots();
              if (roots && roots.length > 0) {
                setRoots(roots);
              }
            } catch (e) {
              console.error(`[project-graph] Failed to get roots: ${e.message}`);
            }
          }
          break;

        case 'notifications/roots/list_changed':
          // Workspace roots changed — re-request
          if (clientSupportsRoots) {
            try {
              const roots = await this.requestRoots();
              if (roots && roots.length > 0) {
                setRoots(roots);
                invalidateCache();
              }
            } catch (e) {
              console.error(`[project-graph] Failed to refresh roots: ${e.message}`);
            }
          }
          break;
      }
    },

        requestRoots() {
      return new Promise((resolve, reject) => {
        const id = nextRequestId++;
        const timeout = setTimeout(() => {
          pendingRequests.delete(id);
          reject(new Error('roots/list request timed out'));
        }, 5000);

        pendingRequests.set(id, {
          resolve: (result) => {
            clearTimeout(timeout);
            resolve(result.roots || []);
          },
          reject: (err) => {
            clearTimeout(timeout);
            reject(err);
          },
        });

        sendToClient({
          jsonrpc: '2.0',
          id,
          method: 'roots/list',
        });
      });
    },

        async executeTool(name, args) {
      const handler = TOOL_HANDLERS[name];
      if (!handler) {
        throw new Error(`Unknown tool: ${name}`);
      }
      return await handler(args);
    },
  };
}

export async function startStdioServer() {
    const sendToClient = (message) => {
    console.log(JSON.stringify(message));
  };

  const server = createServer(sendToClient);
  const readline = await import('readline');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  rl.on('line', async (line) => {
    try {
      const message = JSON.parse(line);
      const response = await server.handleMessage(message);
      if (response !== null) {
        sendToClient(response);
      }
    } catch (e) {
      sendToClient({
        jsonrpc: '2.0',
        error: { code: -32700, message: 'Parse error' },
      });
    }
  });
}
