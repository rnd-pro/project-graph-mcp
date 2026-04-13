/**
 * Format compression stats for display.
 * Two modes auto-detected:
 *   - Compact source (original ≈ codeTok): show delivery size only
 *   - Readable source (original >> codeTok): show source → compact (↓%)
 *
 * @param {{codeTok:number, ctxTok:number, totalTok:number, expanded:number, original:number}} s
 * @param {"full"|"short"} mode
 */
export function formatStats({codeTok=0,ctxTok=0,totalTok=0,expanded=0,original=0}={},mode="full"){
  const _k=v=>(v/1e3).toFixed(1)+"K";
  const src=original||expanded;
  const total=totalTok||(codeTok+(ctxTok||0));
  const savings=src>0?Math.round(100*(1-codeTok/src)):0;
  const isCompactSource=savings<15;

  if(mode==="short"){
    if(isCompactSource)return ctxTok?`${_k(codeTok)} + ${_k(ctxTok)} ctx`:`${_k(codeTok)} tok`;
    const dir=`↓${savings}%`;
    return ctxTok?`${_k(total)} tok (${dir})`:`${_k(codeTok)} tok (${dir})`;
  }

  if(isCompactSource){
    return ctxTok?`${_k(codeTok)} code + ${_k(ctxTok)} ctx = ${_k(total)}`:`${_k(codeTok)} tok`;
  }

  const dir=`↓${savings}%`;
  const compact=ctxTok?`${_k(codeTok)} + ${_k(ctxTok)} ctx = ${_k(total)} compact`:`${_k(codeTok)} compact`;
  return`${_k(src)} source → ${compact} (${dir})`;
}
