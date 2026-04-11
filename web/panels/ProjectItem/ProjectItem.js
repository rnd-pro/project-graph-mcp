import e from"@symbiotejs/symbiote";
import t from"./ProjectItem.css.js";
import r from"./ProjectItem.tpl.js";
export class ProjectItem extends e{init$={prefix:"",projectName:"",projectPath:""};renderCallback(){this.sub("prefix",e=>{this.ref.link.href=e?`${e}/`:"#";if(e){fetch(`${e}/api/compression-stats`).then(r=>r.json()).then(r=>{if(r.compactTokens&&this.ref.tokenBadge){this.ref.tokenBadge.textContent=`${(r.compactTokens/1e3).toFixed(1)}K tok`}}).catch(()=>{})}})}
}ProjectItem.template=r,ProjectItem.rootStyles=t,ProjectItem.reg("pg-project-item");