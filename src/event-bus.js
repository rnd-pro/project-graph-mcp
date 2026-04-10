import { EventEmitter } from 'node:events';

const bus = new EventEmitter();
bus.setMaxListeners(50);

export function emitToolCall(tool, args) {
  bus.emit('tool:call', { type: 'tool_call', tool, args, ts: Date.now() });
}

export function emitToolResult(tool, args, result, durationMs, success) {
  bus.emit('tool:result', {
    type: 'tool_result',
    tool,
    args,
    duration_ms: durationMs,
    success,
    result_keys: result ? Object.keys(result) : [],
    ts: Date.now(),
  });
}

export function onToolCall(fn) {
  bus.on('tool:call', fn);
}

export function onToolResult(fn) {
  bus.on('tool:result', fn);
}

export function removeToolListener(event, fn) {
  bus.off(event, fn);
}

export default bus;
