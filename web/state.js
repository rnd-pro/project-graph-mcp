// @ctx .context/web/state.ctx
const e=new URL(".",import.meta.url).href;
export const state={project:null,skeleton:null,events:[],connected:!1};
const t=new Map;
export function subscribe(e,n){return t.has(e)||t.set(e,new Set),t.get(e).add(n),()=>t.get(e)?.delete(n)}const n=new Set;
export function onEvent(e){return n.add(e),()=>n.delete(e)}
function o(e,n){t.get(e)?.forEach(t=>t(n,e));
const r=e.indexOf(".");if(r>0){const n=e.slice(0,r);t.get(n)?.forEach(e=>e(state[n],n))}t.get("*")?.forEach(t=>t(n,e))}let r=1;
const c=new Map;
export function call(e,t={}){return new Promise((n,a)=>{if(!s||s.readyState!==WebSocket.OPEN)return void a(new Error("WebSocket not connected"));
const d=r++;c.set(d,{resolve:n,reject:a}),s.send(JSON.stringify({jsonrpc:"2.0",id:d,method:"tool",params:{name:e,args:t}})),setTimeout(()=>{c.has(d)&&(c.delete(d),a(new Error(`Tool call timeout: ${e}`)))},3e4)})}let s=null,a=null;function l(e){Object.assign(state,e),state.connected=!0,o("*",state);for(const t of Object.keys(e))o(t,e[t])}
function i(e,t){const n=e.split(".");
let r=state;for(let e=0;e<n.length-1;e++)r[n[e]]||(r[n[e]]={}),r=r[n[e]];r[n[n.length-1]]=t,o(e,t)}
function u(e){let t;try{t=JSON.parse(e)}catch{return}if(t.id&&(void 0!==t.result||t.error)){const e=c.get(t.id);return void(e&&(c.delete(t.id),t.error?e.reject(new Error(t.error.message||"Tool error")):e.resolve(t.result)))}"snapshot"!==t.method?"patch"!==t.method?"event"!==t.method?t.type&&n.forEach(e=>e(t)):n.forEach(e=>e(t.params)):i(t.params.path,t.params.value):l(t.params.state)}
export function connect(){if(s)return;
const t=e.replace(/^http/,"ws");s=new WebSocket(`${t}ws/monitor`),s.onopen=()=>{state.connected=!0,o("connected",!0),a&&(clearTimeout(a),a=null)},s.onmessage=e=>u(e.data),s.onclose=()=>{state.connected=!1,s=null,o("connected",!1);for(const[e,{reject:t}]of c)t(new Error("WebSocket disconnected"));c.clear(),a=setTimeout(connect,3e3)},s.onerror=()=>{}}
export function disconnect(){a&&(clearTimeout(a),a=null),s&&(s.close(),s=null)}