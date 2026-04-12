// @ctx .context/web/panels/ProjectList/ProjectList.ctx
import t from"@symbiotejs/symbiote";import{state as s,events as e}from"../../dashboard-state.js";import r from"./ProjectList.css.js";import o from"./ProjectList.tpl.js";
import"../ProjectItem/ProjectItem.js";
export class ProjectList extends t{init$={projects:[],hasProjects:!1};initCallback(){e.addEventListener("projects-updated",t=>{this.$.projects=t.detail,this.$.hasProjects=t.detail.length>0}),this.$.projects=s.projects,this.$.hasProjects=s.projects.length>0}renderCallback(){this.sub("hasProjects",t=>{this.ref.emptyMsg.hidden=t})}}
ProjectList.template=o,ProjectList.rootStyles=r,ProjectList.reg("pg-project-list");