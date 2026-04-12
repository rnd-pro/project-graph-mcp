// @ctx .context/web/dashboard-state.ctx
export const state={projects:[],events:[]};
export const events=new EventTarget;
export function emit(t,e={}){events.dispatchEvent(new CustomEvent(t,{detail:e}))}