// @ctx event-bus.ctx
import{EventEmitter as o}from"node:events";
const t=new o;
t.setMaxListeners(50);
export function emitToolCall(o,e){t.emit("tool:call",{type:"tool_call",tool:o,args:e,ts:Date.now()})}
export function emitToolResult(o,e,l,n,s){t.emit("tool:result",{type:"tool_result",tool:o,args:e,duration_ms:n,success:s,result_keys:l?Object.keys(l):[],ts:Date.now()})}
export function onToolCall(o){t.on("tool:call",o)}
export function onToolResult(o){t.on("tool:result",o)}
export function removeToolListener(o,e){t.off(o,e)}
export default t;