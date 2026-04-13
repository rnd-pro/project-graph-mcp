/**
 * NPM Install Simulation Test
 *
 * Creates a clean directory OUTSIDE the project, does `npm install`
 * from a local tarball, starts the server, and verifies everything works
 * — including vendor files (symbiote-node, @symbiotejs/symbiote).
 *
 * This catches issues that in-repo tests miss because they always
 * resolve dependencies from the repo's own node_modules.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { startUIServer, httpGetStatus, httpGet, stopUIServer } from './lib/ui-client.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');
const INSTALL_DIR = join('/tmp', `pg-npm-test-${Date.now()}`);

describe('NPM Install Simulation', { concurrency: false, timeout: 60000 }, () => {
  let tarball;
  let serverPath;
  let uiPort;
  let uiProc;

  before(async () => {
    // 1. Pack the local project into a tarball
    const packOutput = execSync('npm pack --pack-destination /tmp 2>/dev/null', {
      cwd: PROJECT_ROOT,
      encoding: 'utf-8',
    }).trim();
    tarball = join('/tmp', packOutput.split('\n').pop());
    assert.ok(existsSync(tarball), `Tarball not created: ${tarball}`);

    // 2. Create a clean directory and install from tarball
    mkdirSync(INSTALL_DIR, { recursive: true });
    writeFileSync(join(INSTALL_DIR, 'package.json'), JSON.stringify({
      name: 'user-project',
      version: '1.0.0',
      private: true,
    }));
    // Simple user source file
    mkdirSync(join(INSTALL_DIR, 'src'), { recursive: true });
    writeFileSync(join(INSTALL_DIR, 'src', 'app.js'), 'export function main() { return 1; }\n');

    execSync(`npm install "${tarball}"`, {
      cwd: INSTALL_DIR,
      stdio: 'pipe',
    });

    // 3. Find server.js in the installed package
    serverPath = join(INSTALL_DIR, 'node_modules', 'project-graph-mcp', 'src', 'network', 'server.js');
    assert.ok(existsSync(serverPath), `server.js not found at ${serverPath}`);

    // 4. Start the web server
    const ui = await startUIServer(serverPath, INSTALL_DIR, 0);
    uiPort = ui.port;
    uiProc = ui.process;
  });

  after(() => {
    stopUIServer(uiProc);
    rmSync(INSTALL_DIR, { recursive: true, force: true });
    if (tarball) rmSync(tarball, { force: true });
  });

  // ── Vendor static files ──────────────────────────────────────────

  it('vendor/symbiote-node/index.js → 200', async () => {
    const { status, contentType } = await httpGetStatus(uiPort, '/vendor/symbiote-node/index.js');
    assert.strictEqual(status, 200, 'symbiote-node not found — _rv() broken');
    assert.ok(contentType.includes('javascript'));
  });

  it('vendor/symbiote/core/index.js → 200', async () => {
    const { status, contentType } = await httpGetStatus(uiPort, '/vendor/symbiote/core/index.js');
    assert.strictEqual(status, 200, '@symbiotejs/symbiote not found — _rv() broken');
    assert.ok(contentType.includes('javascript'));
  });

  it('vendor/symbiote-node/themes/carbon.js → 200', async () => {
    const { status, contentType } = await httpGetStatus(uiPort, '/vendor/symbiote-node/themes/carbon.js');
    assert.strictEqual(status, 200, 'carbon theme not found');
    assert.ok(contentType.includes('javascript'));
  });

  // ── Core static files ────────────────────────────────────────────

  it('/ → index.html 200', async () => {
    const { status, contentType } = await httpGetStatus(uiPort, '/');
    assert.strictEqual(status, 200);
    assert.ok(contentType.includes('html'));
  });

  it('/app.js → 200', async () => {
    const { status, contentType } = await httpGetStatus(uiPort, '/app.js');
    assert.strictEqual(status, 200);
    assert.ok(contentType.includes('javascript'));
  });

  it('/style.css → 200', async () => {
    const { status, contentType } = await httpGetStatus(uiPort, '/style.css');
    assert.strictEqual(status, 200);
    assert.ok(contentType.includes('css'));
  });

  // ── API works from npm install ───────────────────────────────────

  it('/api/skeleton → valid JSON', async () => {
    const { status, data } = await httpGet(uiPort, '/api/skeleton');
    assert.strictEqual(status, 200);
    assert.strictEqual(data.v, 1);
    assert.ok(data.L, 'legend missing');
  });

  it('/api/project-info → project metadata', async () => {
    const { status, data } = await httpGet(uiPort, '/api/project-info');
    assert.strictEqual(status, 200);
    assert.ok(data.name, 'name missing');
    assert.ok(data.pid > 0, 'pid missing');
  });
});
