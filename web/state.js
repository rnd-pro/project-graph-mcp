const e=new URL(".",import.meta.url).href;
export const state={project:null,skeleton:null,events:[],connected:!1};
const t=new Map;
export function subscribe(e,n){return t.has(e)||t.set(e,new Set),t.get(e).add(n),()=>t.get(e)?.delete(n)}const n=new Set;
export function onEvent(e){return n.add(e),()=>n.delete(e)}
function notify(e,n){t.get(e)?.forEach(t=>t(n,e));
const o=e.indexOf(".");if(o>0){const n=e.slice(0,o);t.get(n)?.forEach(e=>e(state[n],n))}t.get("*")?.forEach(t=>t(n,e))}let o=1;
const r=new Map;
export function call(e,t={}){return new Promise((n,s)=>{if(!c||c.readyState!==WebSocket.OPEN)return void s(new Error("WebSocket not connected"));
const a=o++;r.set(a,{resolve:n,reject:s}),c.send(JSON.stringify({jsonrpc:"2.0",id:a,method:"tool",params:{name:e,args:t}})),setTimeout(()=>{r.has(a)&&(r.delete(a),s(new Error(`Tool call timeout: ${e}`)))},3e4)})}let c=null,s=null;function applySnapshot(e){Object.assign(state,e),state.connected=!0,notify("*",state);for(const t of Object.keys(e))notify(t,e[t])}
function applyPatch(e,t){const n=e.split(".");
let o=state;for(let e=0;e<n.length-1;e++)o[n[e]]||(o[n[e]]={}),o=o[n[e]];o[n[n.length-1]]=t,notify(e,t)}
function handleMessage(e){let t;try{t=JSON.parse(e)}catch{return}if(t.id&&(void 0!==t.result||t.error)){const e=r.get(t.id);return void(e&&(r.delete(t.id),t.error?e.reject(new Error(t.error.message||"Tool error")):e.resolve(t.result)))}"snapshot"!==t.method?"patch"!==t.method?"event"!==t.method?t.type&&n.forEach(e=>e(t)):n.forEach(e=>e(t.params)):applyPatch(t.params.path,t.params.value):applySnapshot(t.params.state)}
export function connect(){if(c)return;
const t=e.replace(/^http/,"ws");c=new WebSocket(`${t}ws/monitor`),c.onopen=()=>{state.connected=!0,notify("connected",!0),s&&(clearTimeout(s),s=null)},c.onmessage=e=>handleMessage(e.data),c.onclose=()=>{state.connected=!1,c=null,notify("connected",!1);for(const[e,{reject:t}]of r)t(new Error("WebSocket disconnected"));r.clear(),s=setTimeout(connect,3e3)},c.onerror=()=>{}}
export function disconnect(){s&&(clearTimeout(s),s=null),c&&(c.close(),c=null)}