import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { parseFile, parseProject } from '../src/parser.js';
import { buildGraph, minifyLegend } from '../src/graph-builder.js';

describe('AST Parser', () => {

  describe('parseFile()', () => {

    it('should extract class with methods and properties', async () => {
      const code = `
        import Symbiote from '@symbiotejs/symbiote';
        
        export class SymNode extends Symbiote {
          init$ = {
            nodeTitle: 'Node',
            nodeColor: '#fff',
          };
          
          togglePin() {
            this._pinned = !this._pinned;
          }
          
          getSocketPosition(name) {
            return { x: 0, y: 0 };
          }
        }
      `;

      const result = await parseFile(code, 'SymNode.js');

      assert.strictEqual(result.classes.length, 1);
      assert.strictEqual(result.classes[0].name, 'SymNode');
      assert.strictEqual(result.classes[0].extends, 'Symbiote');
      assert.deepStrictEqual(result.classes[0].properties, ['nodeTitle', 'nodeColor']);
      assert.deepStrictEqual(result.classes[0].methods, ['togglePin', 'getSocketPosition']);
      assert.deepStrictEqual(result.imports, ['Symbiote']);
    });

    it('should extract standalone functions', async () => {
      const code = `
        export function calculateLayout(nodes) {
          return nodes.map(n => ({ ...n, x: 0 }));
        }
        
        function helperFn() {}
      `;

      const result = await parseFile(code, 'utils.js');

      assert.strictEqual(result.functions.length, 2);
      assert.strictEqual(result.functions[0].name, 'calculateLayout');
      assert.strictEqual(result.functions[0].exported, true);
      assert.strictEqual(result.functions[1].name, 'helperFn');
      assert.strictEqual(result.functions[1].exported, false);
    });

    it('should detect method calls to other classes', async () => {
      const code = `
        class Controller {
          init() {
            this.node.togglePin();
            AutoLayout.arrange(this.nodes);
          }
        }
      `;

      const result = await parseFile(code, 'controller.js');

      // node.togglePin detected as call pattern
      assert.ok(result.classes[0].calls.includes('node.togglePin'));
      assert.ok(result.classes[0].calls.includes('AutoLayout.arrange'));
    });

  });

  describe('parseProject()', () => {

    it('should parse all JS files in directory', async () => {
      // Use own src directory
      const result = await parseProject('src');

      assert.ok(result.files.length > 0, 'Should find JS files');
      // Our own source files (parser.js, graph-builder.js, etc.)
      assert.ok(result.functions.length > 0, 'Should find exported functions');
    });

  });

});

describe('Graph Builder', () => {

  describe('minifyLegend()', () => {

    it('should create short aliases for long names', () => {
      const names = ['SymNode', 'SymNodeGraph', 'SymMiniMap', 'togglePin', 'autoArrange'];
      const legend = minifyLegend(names);

      assert.strictEqual(legend['SymNode'], 'SN');
      assert.strictEqual(legend['SymNodeGraph'], 'SNG');
      assert.strictEqual(legend['SymMiniMap'], 'SMM');
      assert.strictEqual(legend['togglePin'], 'tP');
      assert.strictEqual(legend['autoArrange'], 'aA');
    });

    it('should handle collisions with suffix', () => {
      const names = ['SymNode', 'SymNew'];
      const legend = minifyLegend(names);

      // Both would be 'SN', so one gets suffix
      const values = Object.values(legend);
      assert.strictEqual(new Set(values).size, 2); // No duplicates
    });

  });

  describe('buildGraph()', () => {

    it('should build nodes with edges from parsed data', () => {
      const parsed = {
        files: ['SymNode.js', 'SymNodeGraph.js'],
        classes: [
          { name: 'SymNode', methods: ['togglePin'], imports: ['Symbiote'] },
          { name: 'SymNodeGraph', methods: ['addNode'], calls: ['SymNode.togglePin'] },
        ],
      };

      const graph = buildGraph(parsed);

      assert.ok(graph.nodes['SN']);
      assert.ok(graph.nodes['SNG']);
      assert.deepStrictEqual(graph.edges, [
        ['SNG', '→', 'SN.tP'],
      ]);
    });

    it('should detect orphan nodes (no incoming edges)', () => {
      const parsed = {
        files: ['utils.js'],
        classes: [],
        functions: [
          { name: 'helperFn', exported: false, calls: [] },
        ],
      };

      const graph = buildGraph(parsed);

      assert.ok(graph.orphans.includes('helperFn'));
    });

    it('should detect duplicate method names', () => {
      const parsed = {
        files: ['a.js', 'b.js'],
        classes: [
          { name: 'A', methods: ['parsePosition'], file: 'a.js', line: 10 },
          { name: 'B', methods: ['parsePosition'], file: 'b.js', line: 20 },
        ],
      };

      const graph = buildGraph(parsed);

      assert.ok(graph.duplicates['parsePosition']);
      assert.strictEqual(graph.duplicates['parsePosition'].length, 2);
    });

  });

});

describe('Focus Zone', () => {

  it('should prioritize recently modified files', async () => {
    // TODO: Integration with git
  });

});
