import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import { TOOLS } from '../src/mcp/tool-defs.js';
import { createServer } from '../src/mcp/mcp-server.js';

let tempRoots = [];

function makeProject() {
  let root = mkdtempSync(join(tmpdir(), 'project-graph-metadata-'));
  tempRoots.push(root);
  return root;
}

function writeMetadata(root, metadata) {
  let portalDir = join(root, '.portal');
  mkdirSync(portalDir, {
    recursive: true,
  });
  writeFileSync(join(portalDir, 'project-graph.json'), JSON.stringify(metadata), 'utf-8');
}

async function callTool(name, args) {
  let server = createServer(() => {});
  let initResponse = await server.handleMessage({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      roots: [
        {
          uri: 'file://' + args.path,
        },
      ],
    },
  });
  assert.ifError(initResponse.error);
  let response = await server.handleMessage({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: {
      name,
      arguments: args,
    },
  });
  assert.ifError(response.error);
  return JSON.parse(response.result.content[0].text);
}

afterEach(() => {
  for (let root of tempRoots) {
    rmSync(root, {
      recursive: true,
      force: true,
    });
  }
  tempRoots = [];
});

describe('graph_metadata MCP tool', () => {
  it('registers get and validate actions', () => {
    let tool = TOOLS.find((item) => item.name === 'graph_metadata');

    assert.ok(tool);
    assert.deepEqual(tool.inputSchema.properties.action.enum, ['get', 'validate']);
    assert.deepEqual(tool.inputSchema.required, ['action', 'path']);
  });

  it('returns found false when metadata file is missing', async () => {
    let root = makeProject();
    let result = await callTool('graph_metadata', {
      action: 'get',
      path: root,
    });

    assert.equal(result.found, false);
    assert.equal(result.path, join(root, '.portal', 'project-graph.json'));
    assert.equal(result.metadata, null);
    assert.deepEqual(result.errors, []);
  });

  it('reads and validates graph metadata from the project sidecar', async () => {
    let root = makeProject();
    let metadata = {
      version: 1,
      clusters: [
        {
          label: 'Runtime',
          paths: ['src/node/'],
          color: '#12abef',
        },
      ],
      nodeDescriptions: {
        Server: 'Runtime server',
      },
      stories: [
        {
          label: 'Runtime Flow',
          beats: [
            {
              label: 'Server',
              narrative: 'Runtime server starts the portal.',
              nodes: ['src/node/server/backend.js'],
              clusterId: 'runtime',
              focusPath: 'src/node/server/backend.js',
            },
          ],
        },
      ],
      layoutPins: {},
      hiddenNodes: [],
      focusPresets: [],
    };
    writeMetadata(root, metadata);

    let result = await callTool('graph_metadata', {
      action: 'get',
      path: root,
    });

    assert.equal(result.found, true);
    assert.deepEqual(result.metadata, metadata);
    assert.deepEqual(result.errors, []);
  });

  it('validates story beat schema', async () => {
    let root = makeProject();
    let result = await callTool('graph_metadata', {
      action: 'validate',
      path: root,
      metadata: {
        stories: [
          {
            label: 'Bad Flow',
            beats: [
              {
                label: 'Bad Beat',
                nodes: ['ok.js', ''],
                edges: 'not-array',
                clusterId: 42,
                focusPath: 42,
              },
            ],
          },
          {
            label: 'Empty Flow',
            beats: [],
          },
        ],
      },
    });

    assert.equal(result.found, true);
    assert.ok(result.errors.includes('stories[0].beats[0].nodes must be an array of non-empty strings'));
    assert.ok(result.errors.includes('stories[0].beats[0].edges must be an array of non-empty strings'));
    assert.ok(result.errors.includes('stories[0].beats[0].clusterId must be a string'));
    assert.ok(result.errors.includes('stories[0].beats[0].focusPath must be a string'));
    assert.ok(result.errors.includes('stories[1].beats must be a non-empty array'));
  });

  it('validates supplied metadata without requiring a sidecar file', async () => {
    let root = makeProject();
    let result = await callTool('graph_metadata', {
      action: 'validate',
      path: root,
      metadata: {
        clusters: [
          {
            label: 'Browser',
            match: 'web/**',
          },
        ],
      },
    });

    assert.equal(result.found, true);
    assert.deepEqual(result.errors, []);
  });

  it('returns all schema errors for invalid supplied metadata', async () => {
    let root = makeProject();
    let result = await callTool('graph_metadata', {
      action: 'validate',
      path: root,
      metadata: {
        clusters: [
          {
            label: 'Empty',
            color: 'blue',
          },
          null,
        ],
        stories: {},
        hiddenNodes: {},
        focusPresets: {},
        nodeDescriptions: [],
        layoutPins: [],
      },
    });

    assert.equal(result.found, true);
    assert.equal(result.errors.length, 8);
    assert.ok(result.errors.includes('clusters[0] must define at least one path, pattern, node, or match'));
    assert.ok(result.errors.includes('clusters[0].color must be a hex color'));
    assert.ok(result.errors.includes('clusters[1] must be an object'));
    assert.ok(result.errors.includes('stories must be an array'));
    assert.ok(result.errors.includes('hiddenNodes must be an array'));
    assert.ok(result.errors.includes('focusPresets must be an array'));
    assert.ok(result.errors.includes('nodeDescriptions must be an object'));
    assert.ok(result.errors.includes('layoutPins must be an object'));
  });
});
