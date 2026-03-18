/**
 * Core MCP Server Logic
 * 
 * Implements bidirectional JSON-RPC 2.0 over stdio:
 * - Handles client→server requests (tools/list, tools/call)
 * - Sends server→client requests (roots/list) to get workspace info
 */

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
import { getFullAnalysis } from './full-analysis.js';
import { getCustomRules, setCustomRule, checkCustomRules } from './custom-rules.js';
import { getFrameworkReference } from './framework-references.js';
import { setRoots, resolvePath } from './workspace.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Tool handlers registry
 * Maps tool names to their handler functions
 */
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
};

/**
 * Response hints — contextual coaching tips appended to tool responses.
 * Maps tool names to hint generators. Each receives the result and returns
 * an array of hint strings (or empty array for no hints).
 *
 * @type {Record<string, (result: any) => string[]>}
 */
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
};

/**
 * Create MCP server instance
 * @param {Function} sendToClient - Function to send JSON-RPC messages to client
 * @returns {Object}
 */
export function createServer(sendToClient) {
  let nextRequestId = 1;

  /** @type {Map<number, {resolve: Function, reject: Function}>} */
  const pendingRequests = new Map();

  /** @type {boolean} */
  let clientSupportsRoots = false;

  return {
    pendingRequests,

    /**
     * Handle incoming JSON-RPC message (request, response, or notification)
     * @param {Object} message
     * @returns {Promise<Object|null>}
     */
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

    /**
     * Handle MCP notifications
     * @param {string} method
     * @param {Object} params
     */
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

    /**
     * Send roots/list request to client
     * @returns {Promise<Array<{uri: string, name?: string}>>}
     */
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

    /**
     * Execute a tool by name
     * @param {string} name
     * @param {Object} args
     * @returns {Promise<any>}
     */
    async executeTool(name, args) {
      const handler = TOOL_HANDLERS[name];
      if (!handler) {
        throw new Error(`Unknown tool: ${name}`);
      }
      return await handler(args);
    },
  };
}

/**
 * Start server with stdio transport
 */
export async function startStdioServer() {
  /**
   * Send JSON-RPC message to client via stdout
   * @param {Object} message
   */
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
