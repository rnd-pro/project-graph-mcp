/**
 * Core MCP Server Logic
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

/**
 * Create MCP server instance
 * @returns {Object}
 */
export function createServer() {
  return {
    /**
     * Handle incoming MCP request
     * @param {Object} request 
     * @returns {Promise<Object>}
     */
    async handleRequest(request) {
      const { method, params, id } = request;

      try {
        switch (method) {
          case 'initialize':
            return {
              jsonrpc: '2.0',
              id,
              result: {
                protocolVersion: '2024-11-05',
                capabilities: { tools: {} },
                serverInfo: {
                  name: 'project-graph',
                  version: '1.0.0',
                },
              },
            };

          case 'tools/list':
            return {
              jsonrpc: '2.0',
              id,
              result: { tools: TOOLS },
            };

          case 'tools/call':
            const result = await this.executeTool(params.name, params.arguments);
            return {
              jsonrpc: '2.0',
              id,
              result: {
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify(result, null, 2),
                  },
                ],
              },
            };

          default:
            return {
              jsonrpc: '2.0',
              id,
              error: { code: -32601, message: `Method not found: ${method}` },
            };
        }
      } catch (error) {
        return {
          jsonrpc: '2.0',
          id,
          error: { code: -32000, message: error.message },
        };
      }
    },

    /**
     * Execute a tool by name
     * @param {string} name 
     * @param {Object} args 
     * @returns {Promise<any>}
     */
    async executeTool(name, args) {
      switch (name) {
        // Graph Tools
        case 'get_skeleton':
          return await getSkeleton(args.path);
        case 'get_focus_zone':
          return await getFocusZone(args);
        case 'expand':
          return await expand(args.symbol);
        case 'deps':
          return await deps(args.symbol);
        case 'usages':
          return await usages(args.symbol);
        case 'invalidate_cache':
          invalidateCache();
          return { success: true };

        // Test Checklist Tools
        case 'get_pending_tests':
          return getPendingTests(args.path);
        case 'mark_test_passed':
          return markTestPassed(args.testId);
        case 'mark_test_failed':
          return markTestFailed(args.testId, args.reason);
        case 'get_test_summary':
          return getTestSummary(args.path);
        case 'reset_test_state':
          return resetTestState();

        // Filter Tools
        case 'get_filters':
          return getFilters();
        case 'set_filters':
          return setFilters(args);
        case 'add_excludes':
          return addExcludes(args.dirs);
        case 'remove_excludes':
          return removeExcludes(args.dirs);
        case 'reset_filters':
          return resetFilters();

        // Guidelines
        case 'get_agent_instructions':
          return getInstructions();

        // Documentation
        case 'get_undocumented':
          return getUndocumentedSummary(args.path, args.level || 'tests');

        // Code Quality
        case 'get_dead_code':
          return await getDeadCode(args.path);

        case 'generate_jsdoc':
          if (args.name) {
            return generateJSDocFor(args.path, args.name);
          }
          return generateJSDoc(args.path);

        case 'get_similar_functions':
          return await getSimilarFunctions(args.path, { threshold: args.threshold });

        case 'get_complexity':
          return await getComplexity(args.path, {
            minComplexity: args.minComplexity,
            onlyProblematic: args.onlyProblematic,
          });

        case 'get_large_files':
          return await getLargeFiles(args.path, { onlyProblematic: args.onlyProblematic });

        case 'get_outdated_patterns':
          return await getOutdatedPatterns(args.path, {
            codeOnly: args.codeOnly,
            depsOnly: args.depsOnly,
          });

        case 'get_full_analysis':
          return await getFullAnalysis(args.path, { includeItems: args.includeItems });

        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    },
  };
}

/**
 * Start server with stdio transport
 */
export async function startStdioServer() {
  const server = createServer();
  const readline = await import('readline');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  rl.on('line', async (line) => {
    try {
      const request = JSON.parse(line);
      const response = await server.handleRequest(request);
      console.log(JSON.stringify(response));
    } catch (e) {
      console.log(JSON.stringify({
        jsonrpc: '2.0',
        error: { code: -32700, message: 'Parse error' },
      }));
    }
  });
}
