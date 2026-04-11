import t from"@symbiotejs/symbiote";
import e from"./EventItem.css.js";
import i from"./EventItem.tpl.js";
export class EventItem extends t{init$={ts:0,type:"",tool:""};renderCallback(){this.sub("ts",t=>{this.ref.time.textContent=t?new Date(t).toLocaleTimeString("ru-RU",{hour:"2-digit",minute:"2-digit",second:"2-digit"}):""})}}EventItem.template=i,EventItem.rootStyles=e,EventItem.reg("pg-event-item");