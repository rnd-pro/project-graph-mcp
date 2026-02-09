/**
 * Core MCP Server Logic
 * 
 * Implements bidirectional JSON-RPC 2.0 over stdio:
 * - Handles client→server requests (tools/list, tools/call)
 * - Sends server→client requests (roots/list) to get workspace info
 */

import { TOOLS } from './tool-defs.js';
import { getSkeleton, getFocusZone, expand, deps, usages, invalidateCache } from './tools.js';
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
import { setRoots, resolvePath } from './workspace.js';

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
                capabilities: { tools: {} },
                serverInfo: { name: 'project-graph', version: '1.1.0' },
              },
            };

          case 'tools/list':
            return { jsonrpc: '2.0', id, result: { tools: TOOLS } };

          case 'tools/call': {
            const result = await this.executeTool(params.name, params.arguments);
            return {
              jsonrpc: '2.0',
              id,
              result: {
                content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
              },
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
