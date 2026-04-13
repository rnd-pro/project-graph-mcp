/**
 * Format compression stats for display.
 * @param {{codeTok:number, ctxTok:number, totalTok:number, expanded:number}} s
 * @param {"full"|"short"} mode - "full" = source → compact (pct), "short" = compact (pct)
 */
export function formatStats({codeTok=0,ctxTok=0,totalTok=0,expanded=0}={},mode="full"){
  const _k=v=>(v/1e3).toFixed(1)+"K";
  const total=totalTok||(codeTok+(ctxTok||0));
  const pct=expanded>0?Math.round(100*(1-total/expanded)):0;
  const dir=pct>=0?`↓${pct}%`:`↑${Math.abs(pct)}%`;
  if(mode==="short")return ctxTok?`${_k(total)} tok (${dir})`:`${_k(codeTok)} tok (${dir})`;
  const src=`${_k(expanded)} source`;
  const compact=ctxTok?`${_k(codeTok)} + ${_k(ctxTok)} ctx = ${_k(total)} compact`:`${_k(codeTok)} compact`;
  return`${src} → ${compact} (${dir})`;
}
