import { describe, it } from 'node:test';
import assert from 'node:assert';
import { TOOLS } from '../src/tool-defs.js';

describe('Tool Consolidation', () => {
  it('TOOLS has 18 consolidated tools', () => {
    assert.strictEqual(TOOLS.length, 18);
  });

  it('all standalone tools reference valid TOOLS entries', () => {
    const standaloneNames = [
      'get_skeleton', 'get_focus_zone', 'get_ai_context', 'invalidate_cache',
      'get_usage_guide', 'get_agent_instructions', 'get_custom_rules',
      'set_custom_rule', 'check_custom_rules', 'get_framework_reference',
    ];
    for (const name of standaloneNames) {
      const tool = TOOLS.find(t => t.name === name);
      assert.ok(tool, `Standalone tool ${name} missing from TOOLS`);
      assert.strictEqual(tool.name, name);
    }
  });

  it('all 8 grouped tools have action enum', () => {
    const groupedNames = ['navigate', 'analyze', 'testing', 'filters', 'jsdoc', 'docs', 'compact', 'db'];
    for (const name of groupedNames) {
      const tool = TOOLS.find(t => t.name === name);
      assert.ok(tool, `Grouped tool ${name} missing`);
      const actionProp = tool.inputSchema.properties.action;
      assert.ok(actionProp, `${name} missing action property`);
      assert.ok(actionProp.enum, `${name} action missing enum`);
      assert.ok(actionProp.enum.length > 0, `${name} action enum is empty`);
    }
  });

  it('navigate has correct actions', () => {
    const tool = TOOLS.find(t => t.name === 'navigate');
    assert.deepStrictEqual(tool.inputSchema.properties.action.enum,
      ['expand', 'deps', 'usages', 'call_chain', 'sub_projects']);
  });

  it('analyze has correct actions', () => {
    const tool = TOOLS.find(t => t.name === 'analyze');
    assert.deepStrictEqual(tool.inputSchema.properties.action.enum,
      ['dead_code', 'similar_functions', 'complexity', 'large_files',
       'outdated_patterns', 'full_analysis', 'analysis_summary', 'undocumented']);
  });

  it('no duplicate tool names in consolidated', () => {
    const names = TOOLS.map(t => t.name);
    const unique = new Set(names);
    assert.strictEqual(names.length, unique.size, `Duplicate names: ${names.filter((n, i) => names.indexOf(n) !== i)}`);
  });
});

describe('Consolidated Dispatch', async () => {
  const { createServer } = await import('../src/mcp-server.js');
  const server = createServer(() => {});

  it('dispatches navigate.expand', async () => {
    // First load graph
    await server.executeTool('get_skeleton', { path: '.' });
    const result = await server.executeTool('navigate', { action: 'expand', symbol: 'parseFile' });
    assert.ok(result);
  });

  it('dispatches analyze.complexity', async () => {
    const result = await server.executeTool('analyze', { action: 'complexity', path: 'src/' });
    assert.ok(result);
  });

  it('dispatches testing.reset', async () => {
    const result = await server.executeTool('testing', { action: 'reset' });
    assert.ok(result);
  });

  it('dispatches filters.get', async () => {
    const result = await server.executeTool('filters', { action: 'get' });
    assert.ok(result);
  });

  it('dispatches docs.validate_contracts', async () => {
    const result = await server.executeTool('docs', { action: 'validate_contracts', path: '.' });
    assert.ok(result);
    assert.ok(result.summary !== undefined);
  });

  it('dispatches compact.get_mode', async () => {
    const result = await server.executeTool('compact', { action: 'get_mode', path: '.' });
    assert.ok(result);
    assert.ok(result.mode !== undefined);
  });

  it('dispatches db.schema', async () => {
    const result = await server.executeTool('db', { action: 'schema', path: '.' });
    assert.ok(result);
  });

  it('throws on unknown action', async () => {
    await assert.rejects(
      () => server.executeTool('navigate', { action: 'nonexistent' }),
      /Unknown navigate action/,
    );
  });

  it('still works with expanded tool names', async () => {
    const result = await server.executeTool('get_complexity', { path: 'src/' });
    assert.ok(result);
  });
});
