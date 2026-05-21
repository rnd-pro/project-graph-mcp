import { execFileSync, execSync, spawn } from "node:child_process";

import { rmSync, mkdirSync, copyFileSync, readdirSync, writeFileSync } from "node:fs";

import { join, dirname } from "node:path";

import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const ROOT_DIR = join(__dirname, "..");

const TEST_DIR = join(ROOT_DIR, "tmp", "consumer-test");

let cleaned = false;

function cleanup() {
  if (cleaned) return;
  cleaned = true;
  rmSync(TEST_DIR, {
    recursive: true,
    force: true
  });
}

function fail(message, error) {
  console.error(`❌ ${message}`);
  if (error?.stdout) console.error(`[stdout]\n${error.stdout.toString()}`);
  if (error?.stderr) console.error(`[stderr]\n${error.stderr.toString()}`);
  cleanup();
  process.exit(1);
}

function runNpx(args, options = {}) {
  return execFileSync("npx", args, {
    cwd: TEST_DIR,
    encoding: "utf8",
    timeout: 15_000,
    ...options
  });
}

process.on("exit", cleanup);
process.on("SIGINT", () => {
  cleanup();
  process.exit(130);
});
process.on("SIGTERM", () => {
  cleanup();
  process.exit(143);
});

console.log("🚀 Starting Consumer Packaging Test...");

console.log("\n🧹 Cleaning up test directory...");

rmSync(TEST_DIR, {
  recursive: true,
  force: true
});

mkdirSync(TEST_DIR, {
  recursive: true
});

console.log("\n🧹 Removing old tarballs...");

const oldTarballs = readdirSync(ROOT_DIR).filter(f => f.endsWith(".tgz") && f.startsWith("project-graph-mcp-"));

for (const ot of oldTarballs) {
  rmSync(join(ROOT_DIR, ot));
}

console.log("\n📦 Running npm pack...");

execSync("npm pack", {
  cwd: ROOT_DIR,
  stdio: "inherit"
});

const tarballs = readdirSync(ROOT_DIR).filter(f => f.endsWith(".tgz"));

if (tarballs.length === 0) {
  console.error("❌ Failed to generate tarball!");
  process.exit(1);
}

const tarball = tarballs.find(t => t.startsWith("project-graph-mcp-"));

const tarballPath = join(ROOT_DIR, tarball);

const destTarball = join(TEST_DIR, tarball);

console.log(`📦 Found tarball: ${tarball}`);

copyFileSync(tarballPath, destTarball);

rmSync(tarballPath);

console.log("\n💿 Simulating consumer installation...");

execSync("npm init -y", {
  cwd: TEST_DIR,
  stdio: "ignore"
});

console.log(`💿 Running npm install ./${tarball} ...`);

execSync(`npm install ./${tarball}`, {
  cwd: TEST_DIR,
  stdio: "inherit"
});

writeFileSync(join(TEST_DIR, "sample.js"), "export function sample() { return 1; }\n");

console.log("\n🧪 Verifying installed CLI...");

try {
  const help = runNpx([ "project-graph-mcp", "help" ]);
  if (!help.includes("Start MCP stdio server") || !help.includes("skeleton <path>")) {
    fail("CLI help output did not include expected commands.");
  }
  console.log("  ✅ CLI help loaded");

  const skeletonRaw = runNpx([ "project-graph-mcp", "skeleton", "." ]);
  const skeleton = JSON.parse(skeletonRaw);
  if (skeleton.v !== 1 || !skeleton.L || typeof skeleton.s !== "object") {
    fail("CLI skeleton command returned an unexpected shape.");
  }
  console.log("  ✅ CLI skeleton command returned JSON");
} catch (error) {
  fail("Installed CLI check failed.", error);
}

console.log("\n🟢 Starting the MCP stdio server...");

const serverProcess = spawn("npx", [ "project-graph-mcp" ], {
  cwd: TEST_DIR,
  stdio: [ "pipe", "pipe", "pipe" ]
});

let stdoutBuffer = "";
let stderrBuffer = "";
let serverExited = false;

serverProcess.stdout.on("data", data => {
  stdoutBuffer += data.toString();
});

serverProcess.stderr.on("data", data => {
  stderrBuffer += data.toString();
});

serverProcess.on("exit", () => {
  serverExited = true;
});

function waitForStdoutLine(predicate, timeoutMs = 10_000) {
  return new Promise(resolve => {
    const started = Date.now();
    const interval = setInterval(() => {
      const lines = stdoutBuffer.split(/\r?\n/).filter(Boolean);
      const match = lines.find(line => {
        try {
          return predicate(JSON.parse(line));
        } catch {
          return false;
        }
      });
      if (match || Date.now() - started > timeoutMs || serverExited) {
        clearInterval(interval);
        resolve(match || null);
      }
    }, 100);
  });
}

const initializeRequest = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: {
      name: "consumer-test",
      version: "0.0.0"
    },
    roots: [
      {
        uri: `file://${TEST_DIR}`,
        name: "consumer-test"
      }
    ]
  }
};

serverProcess.stdin.write(`${JSON.stringify(initializeRequest)}\n`);

const initializeResponse = await waitForStdoutLine(message => message.id === 1 && message.result?.serverInfo?.name === "project-graph");

if (!initializeResponse) {
  serverProcess.kill();
  fail(`MCP stdio server did not initialize.\n[stdout]\n${stdoutBuffer}\n[stderr]\n${stderrBuffer}`);
}

console.log("  ✅ MCP stdio initialize responded");

console.log("\n🛑 Shutting down server...");
serverProcess.kill();
cleanup();
console.log("\n🎉 ALL CONSUMER TESTS PASSED. Ready for publish.");
process.exit(0);
