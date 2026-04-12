// @ctx .context/src/core/utils.ctx
export function estimateTokens(e){const t="string"==typeof e?e:JSON.stringify(e);return Math.ceil(t.length/4)}
