import { describe, it } from 'node:test';
import assert from 'node:assert';

describe('MCP Tools', () => {

  describe('get_skeleton()', () => {

    it('should return compact project overview', async () => {
      const { getSkeleton } = await import('../src/tools.js');

      // Use own src directory
      const skeleton = await getSkeleton('src');

      assert.ok(skeleton.v, 'Should have version');
      assert.ok(skeleton.L, 'Should have legend (L)');
      assert.ok(skeleton.s, 'Should have stats (s)');
      assert.ok(skeleton.s.files > 0, 'Should have files');
    });

    it('should fit in ~500 tokens', async () => {
      const { getSkeleton } = await import('../src/tools.js');

      const skeleton = await getSkeleton('src');
      const json = JSON.stringify(skeleton);

      // Rough estimate: 4 chars per token
      const estimatedTokens = json.length / 4;
      assert.ok(estimatedTokens < 600, `Too many tokens: ${estimatedTokens}`);
    });

  });

  describe('expand()', () => {

    it('should return info for symbol', async () => {
      const { expand, invalidateCache } = await import('../src/tools.js');

      // First get skeleton to populate cache
      const { getSkeleton } = await import('../src/tools.js');
      invalidateCache();
      await getSkeleton('src');

      // Expand a known symbol from our own code
      const result = await expand('parseFile');

      assert.ok(result, 'Should return result');
    });

  });

});

describe('MCP Server', () => {

  it('should respond to list_tools', async () => {
    const { createServer } = await import('../src/mcp-server.js');
    const server = createServer();

    const response = await server.handleRequest({
      jsonrpc: '2.0',
      method: 'tools/list',
      id: 1,
    });

    assert.ok(response.result.tools);
    const toolNames = response.result.tools.map(t => t.name);
    assert.ok(toolNames.includes('get_skeleton'));
    assert.ok(toolNames.includes('expand'));
    assert.ok(toolNames.includes('deps'));
    // New test tools
    assert.ok(toolNames.includes('get_pending_tests'));
    assert.ok(toolNames.includes('mark_test_passed'));
  });

  it('should execute get_skeleton tool', async () => {
    const { createServer } = await import('../src/mcp-server.js');
    const server = createServer();

    const response = await server.handleRequest({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: {
        name: 'get_skeleton',
        arguments: { path: 'src' },
      },
      id: 2,
    });

    assert.ok(response.result, 'Should have result');
    assert.ok(!response.error, 'Should not have error');
  });

  it('should execute get_pending_tests tool', async () => {
    const { createServer } = await import('../src/mcp-server.js');
    const server = createServer();

    const response = await server.handleRequest({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: {
        name: 'get_pending_tests',
        arguments: { path: 'src' },
      },
      id: 3,
    });

    assert.ok(response.result, 'Should have result');
    assert.ok(!response.error, 'Should not have error');
  });

  it('should execute get_test_summary tool', async () => {
    const { createServer } = await import('../src/mcp-server.js');
    const server = createServer();

    const response = await server.handleRequest({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: {
        name: 'get_test_summary',
        arguments: { path: 'src' },
      },
      id: 5,
    });

    assert.ok(response.result, 'Should have result');
    const content = JSON.parse(response.result.content[0].text);
    assert.strictEqual(content.passed, 0);
  });

  it('should execute get_agent_instructions', async () => {
    const { createServer } = await import('../src/mcp-server.js');
    const server = createServer();

    const response = await server.handleRequest({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: {
        name: 'get_agent_instructions',
        arguments: {},
      },
      id: 6,
    });

    assert.ok(response.result, 'Should have result');
    const content = JSON.parse(response.result.content[0].text);

    // content should be the instruction string
    assert.ok(content.includes('Project Guidelines'), 'Should contain title');
    assert.ok(content.includes('@test'), 'Should contain annotations info');
  });

  it('should execute get_undocumented tool', async () => {
    const { createServer } = await import('../src/mcp-server.js');
    const server = createServer();

    const response = await server.handleRequest({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: {
        name: 'get_undocumented',
        arguments: { path: 'src', level: 'all' },
      },
      id: 7,
    });

    assert.ok(response.result, 'Should have result');
    const content = JSON.parse(response.result.content[0].text);
    assert.ok(typeof content.total === 'number', 'Should have total count');
    assert.ok(Array.isArray(content.items), 'Should have items array');
  });

});
