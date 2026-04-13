/**
 * Format compression stats for display.
 * Always shows savings vs expanded (beautified) baseline.
 * @param {{codeTok:number, ctxTok:number, totalTok:number, expanded:number}} s
 * @param {"full"|"short"} mode
 */
export function formatStats({codeTok=0,ctxTok=0,totalTok=0,expanded=0}={},mode="full"){
  const _k=v=>(v/1e3).toFixed(1)+"K";
  const total=totalTok||(codeTok+(ctxTok||0));
  const pct=expanded>0?Math.round(100*(1-total/expanded)):0;
  const dir=pct>=0?`↓${pct}%`:`↑${Math.abs(pct)}%`;
  if(mode==="short")return`${_k(total)} of ${_k(expanded)} (${dir})`;
  const compact=ctxTok?`${_k(codeTok)} + ${_k(ctxTok)} ctx = ${_k(total)}`:`${_k(codeTok)}`;
  return`${_k(expanded)} source → ${compact} compact (${dir})`;
}
