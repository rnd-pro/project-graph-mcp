import http from 'http';
import crypto from 'crypto';

const port = 80;
const host = 'project-graph.local';
const path = '/project-graph-mcp/ws/monitor';
const key = crypto.randomBytes(16).toString('base64');

console.log(`Connecting to ws://${host}:${port}${path}`);

const req = http.request({
  method: 'GET',
  port,
  host,
  path,
  headers: {
    'Connection': 'Upgrade',
    'Upgrade': 'websocket',
    'Sec-WebSocket-Version': '13',
    'Sec-WebSocket-Key': key,
    'Host': host
  }
});

req.on('upgrade', (res, socket, head) => {
  console.log('Success! Got 101 Switching Protocols');
  socket.end();
});

req.on('response', (res) => {
  console.log('Failed! Got normal response with status:', res.statusCode);
});

req.on('error', (err) => {
  console.error('Request Error:', err.message);
});

req.end();
