import e from"@symbiotejs/symbiote";
import t from"./ProjectItem.css.js";
import r from"./ProjectItem.tpl.js";
export class ProjectItem extends e{init$={prefix:"",projectName:"",projectPath:""};renderCallback(){this.sub("prefix",e=>{this.ref.link.href=e?`${e}/`:"#"})}}ProjectItem.template=r,ProjectItem.rootStyles=t,ProjectItem.reg("pg-project-item");