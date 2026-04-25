// @ctx .context/web/panels/ActionBoard/ActionBoard.ctx
import t from"@symbiotejs/symbiote";import{state as e,events as o}from"../../dashboard-state.js";import s from"./ActionBoard.css.js";import n from"./ActionBoard.tpl.js";
import"../EventItem/EventItem.js";
export class ActionBoard extends t{init$={eventsItems:[]};initCallback(){o.addEventListener("global-tool-event",t=>{const o=[...e.events].reverse();this.$.eventsItems=o}),this.$.eventsItems=[...e.events].reverse()}}
ActionBoard.template=n,ActionBoard.rootStyles=s,ActionBoard.reg("pg-action-board");