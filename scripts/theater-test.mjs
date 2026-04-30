import WebSocket from 'ws';

const PORT = 3777;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function runTheaterTest() {
  console.log('🎬 Starting E2E Magic Automation Theater Test...');
  
  // 1. Connect Monitor WebSocket
  const monitorWs = new WebSocket(`ws://127.0.0.1:${PORT}/ws/monitor`);
  const receivedEvents = [];
  
  monitorWs.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.method === 'event' && msg.params?.type === 'tool_call') {
        const toolName = msg.params.tool || msg.params.name || '';
        receivedEvents.push(toolName);
        console.log(`  📡 UI Monitor Received: [${toolName}]`);
      }
    } catch (e) {}
  });

  await new Promise((resolve, reject) => {
    monitorWs.on('open', resolve);
    monitorWs.on('error', reject);
  });
  console.log('✅ UI Monitor WebSocket connected.');

  // 2. Connect Agent WebSocket
  const agentWs = new WebSocket(`ws://127.0.0.1:${PORT}/mcp-ws`);
  
  let msgId = 1;
  const pendingRequests = new Map();

  agentWs.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.id && pendingRequests.has(msg.id)) {
        pendingRequests.get(msg.id)(msg.result || msg.error);
        pendingRequests.delete(msg.id);
      }
    } catch (e) {}
  });

  await new Promise((resolve, reject) => {
    agentWs.on('open', resolve);
    agentWs.on('error', reject);
  });
  console.log('✅ Agent MCP WebSocket connected.\n');

  function callTool(toolName, args) {
    return new Promise((resolve) => {
      const id = msgId++;
      pendingRequests.set(id, resolve);
      agentWs.send(JSON.stringify({
        jsonrpc: '2.0',
        id,
        method: 'tools/call',
        params: { name: toolName, arguments: args }
      }));
    });
  }

  // 3. Define the expected sequence of actions
  const actions = [
    { name: 'Loading web skeleton', tool: 'get_skeleton', args: { path: 'web' } },
    { name: 'Tracing usages of followController', tool: 'navigate', args: { action: 'usages', symbol: 'followController' } },
    { name: 'Compacting / Viewing app.js', tool: 'compact', args: { action: 'compact_file', path: 'web/app.js' } },
    { name: 'Analyzing follow-controller.js', tool: 'analyze', args: { action: 'full_analysis', path: 'web/follow-controller.js' } },
  ];

  for (const action of actions) {
    console.log(`▶️ Agent Executing: ${action.name} (Tool: ${action.tool})`);
    
    // Clear event queue for this step
    receivedEvents.length = 0;
    
    callTool(action.tool, action.args);
    
    // Wait for the monitor to receive the broadcast
    let waited = 0;
    while (receivedEvents.length === 0 && waited < 10000) {
      await sleep(100);
      waited += 100;
    }
    
    // Verify
    const matched = receivedEvents.some(ev => ev.includes(action.tool));
    if (matched) {
      console.log(`  ✅ Verified Monitor received event for '${action.tool}'`);
    } else {
      console.error(`  ❌ FAILED: Monitor did not receive expected event '${action.tool}'`);
      console.error(`  Received events:`, receivedEvents);
      process.exit(1);
    }
    
    console.log('');
    await sleep(2000); // Visual pause for the UI
  }

  console.log('✨ All E2E Theater tests passed! The UI is receiving events correctly.');
  monitorWs.close();
  agentWs.close();
  process.exit(0);
}

runTheaterTest();
