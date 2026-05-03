import { spawn, execSync } from "child_process";

import { existsSync, mkdirSync, writeFileSync } from "fs";

import { join } from "path";

import assert from "node:assert/strict";

export class MCPClient {
  constructor(serverPath, projectDir) {
    this._serverPath = serverPath;
    this._projectDir = projectDir;
    this._nextId = 1;
    this._pending = new Map;
    this._buffer = "";
    this._child = null;
    this._stderr = "";
  }
  async start() {
    this._child = spawn("node", [ this._serverPath ], {
      env: {
        ...process.env,
        PROJECT_GRAPH_BACKEND: "1"
      },
      stdio: [ "pipe", "pipe", "pipe" ],
      cwd: this._projectDir
    });
    this._child.stdout.on("data", chunk => {
      this._buffer += chunk.toString();
      const lines = this._buffer.split("\n");
      this._buffer = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.id !== undefined && this._pending.has(msg.id)) {
            const {resolve: resolve, reject: reject} = this._pending.get(msg.id);
            this._pending.delete(msg.id);
            if (msg.error) reject(new Error(msg.error.message)); else resolve(msg);
          }
        } catch {}
      }
    });
    this._child.stderr.on("data", d => {
      this._stderr += d.toString();
    });
    return this;
  }
  _send(msg) {
    this._child.stdin.write(JSON.stringify(msg) + "\n");
  }
  _request(method, params = {}) {
    const id = this._nextId++;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this._pending.delete(id);
        reject(new Error(`Timeout: ${method} (id=${id}). stderr: ${this._stderr.slice(-500)}`));
      }, 15e3);
      this._pending.set(id, {
        resolve: msg => {
          clearTimeout(timeout);
          resolve(msg);
        },
        reject: err => {
          clearTimeout(timeout);
          reject(err);
        }
      });
      this._send({
        jsonrpc: "2.0",
        id: id,
        method: method,
        params: params
      });
    });
  }
  async initialize() {
    const resp = await this._request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: {
        name: "integration-test",
        version: "1.0.0"
      },
      roots: [ {
        uri: "file://" + this._projectDir
      } ]
    });
    this._send({
      jsonrpc: "2.0",
      method: "notifications/initialized"
    });
    await new Promise(r => setTimeout(r, 100));
    return resp;
  }
  async listTools() {
    const resp = await this._request("tools/list");
    return resp.result.tools;
  }
  async listResources() {
    const resp = await this._request("resources/list");
    return resp.result.resources;
  }
  async readResource(uri) {
    const resp = await this._request("resources/read", {
      uri: uri
    });
    return resp.result;
  }
  async callTool(name, args = {}) {
    const resp = await this._request("tools/call", {
      name: name,
      arguments: args
    });
    const content = resp.result.content;
    assert.ok(Array.isArray(content), `${name}: content should be array`);
    assert.ok(content.length >= 1, `${name}: need at least 1 content item`);
    assert.strictEqual(content[0].type, "text");
    return {
      data: JSON.parse(content[0].text),
      hints: content.length > 1 ? content[1].text : null
    };
  }
  stop() {
    if (this._child && !this._child.killed) {
      this._child.kill("SIGTERM");
    }
  }
}

export function resolveServerPath(projectRoot, fixtureRoot) {
  if (process.env.VERIFY_NPM === "1") {
    const npmDir = join(fixtureRoot, "_npm_install");
    mkdirSync(npmDir, {
      recursive: true
    });
    writeFileSync(join(npmDir, "package.json"), '{"name":"verifier","private":true}');
    execSync("npm install project-graph-mcp", {
      cwd: npmDir,
      stdio: "pipe"
    });
    const binPath = join(npmDir, "node_modules", "project-graph-mcp", "src", "network", "server.js");
    if (!existsSync(binPath)) throw new Error("NPM install failed: server.js not found");
    return binPath;
  }
  return join(projectRoot, "src", "network", "server.js");
}
