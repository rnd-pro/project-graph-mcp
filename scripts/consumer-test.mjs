import { execSync, spawn } from 'node:child_process';
import { rmSync, mkdirSync, copyFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(__dirname, '..');
const TEST_DIR = join(ROOT_DIR, 'tests', 'tmp-consumer-test');

console.log('🚀 Starting Consumer Packaging Test...');

// 1. Cleanup and prepare
console.log('\n🧹 Cleaning up test directory...');
rmSync(TEST_DIR, { recursive: true, force: true });
mkdirSync(TEST_DIR, { recursive: true });

// 2. Pack the project
console.log('\n🧹 Removing old tarballs...');
const oldTarballs = readdirSync(ROOT_DIR).filter(f => f.endsWith('.tgz') && f.startsWith('project-graph-mcp-'));
for (const ot of oldTarballs) {
  rmSync(join(ROOT_DIR, ot));
}

console.log('\n📦 Running npm pack...');
execSync('npm pack', { cwd: ROOT_DIR, stdio: 'inherit' });

// Find the generated tarball
const tarballs = readdirSync(ROOT_DIR).filter(f => f.endsWith('.tgz'));
if (tarballs.length === 0) {
  console.error('❌ Failed to generate tarball!');
  process.exit(1);
}

// Sort by modification time to get the latest, or just take the first if there's only one.
// We'll just grab the first one that matches our project.
const tarball = tarballs.find(t => t.startsWith('project-graph-mcp-'));
const tarballPath = join(ROOT_DIR, tarball);
const destTarball = join(TEST_DIR, tarball);

console.log(`📦 Found tarball: ${tarball}`);
copyFileSync(tarballPath, destTarball);
rmSync(tarballPath); // Clean up root

// 3. Simulate consumer installation
console.log('\n💿 Simulating consumer installation...');
execSync('npm init -y', { cwd: TEST_DIR, stdio: 'ignore' });
console.log(`💿 Running npm install ./${tarball} ...`);
execSync(`npm install ./${tarball}`, { cwd: TEST_DIR, stdio: 'inherit' });

// 4. Start the server
console.log('\n🟢 Starting the MCP web server...');
const PORT = 19876;
const serverProcess = spawn('npx', ['project-graph-mcp', 'serve', '.', '--port', PORT.toString()], {
  cwd: TEST_DIR,
  stdio: 'pipe'
});

let serverReady = false;
serverProcess.stdout.on('data', (data) => {
  const output = data.toString();
  if (output.includes(`localhost:${PORT}`)) {
    serverReady = true;
  }
});

serverProcess.stderr.on('data', (data) => {
  console.error(`[SERVER ERR]: ${data.toString()}`);
});

// Helper to fetch with timeout
function checkUrl(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      resolve(res.statusCode);
    });
    req.on('error', () => resolve(0));
    req.setTimeout(2000, () => {
      req.destroy();
      resolve(0);
    });
  });
}

// 5. Verification loop
console.log('⏳ Waiting for server to boot...');
let attempts = 0;

const checkInterval = setInterval(async () => {
  attempts++;
  
  if (serverReady || attempts > 10) {
    clearInterval(checkInterval);
    
    if (!serverReady) {
      console.error('❌ Server failed to start within 10 seconds.');
      serverProcess.kill();
      process.exit(1);
    }

    console.log('✅ Server booted successfully. Running integrity checks...');

    let allPassed = true;

    // Test 1: Main UI loads
    const uiStatus = await checkUrl(`http://127.0.0.1:${PORT}/`);
    if (uiStatus === 200) {
      console.log('  ✅ [200] Main UI loaded');
    } else {
      console.error(`  ❌ [${uiStatus}] Main UI failed to load`);
      allPassed = false;
    }

    // Test 2: Symbiote Node Engine files load (The file that caused 404 earlier)
    const engineFileStatus = await checkUrl(`http://127.0.0.1:${PORT}/vendor/symbiote-node/engine/packs/transform/template-builder.handler.js`);
    if (engineFileStatus === 200) {
      console.log('  ✅ [200] symbiote-node engine files loaded successfully');
    } else {
      console.error(`  ❌ [${engineFileStatus}] symbiote-node engine files missing (packaging error!)`);
      allPassed = false;
    }
    
    // Test 3: API Endpoint responds
    const apiStatus = await checkUrl(`http://127.0.0.1:${PORT}/api/server-status`);
    if (apiStatus === 200) {
      console.log('  ✅ [200] /api/server-status responded');
    } else {
      console.error(`  ❌ [${apiStatus}] /api/server-status failed`);
      allPassed = false;
    }

    // Cleanup
    console.log('\n🛑 Shutting down server...');
    serverProcess.kill();
    rmSync(TEST_DIR, { recursive: true, force: true });

    if (allPassed) {
      console.log('\n🎉 ALL CONSUMER TESTS PASSED. Ready for publish.');
      process.exit(0);
    } else {
      console.log('\n⚠️ CONSUMER TESTS FAILED. Fix packaging issues before publish.');
      process.exit(1);
    }
  }
}, 1000);
