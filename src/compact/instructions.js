// @ctx instructions.ctx
import{readFileSync}from"fs";import{join,dirname}from"path";import{fileURLToPath}from"url";
const __dir=dirname(fileURLToPath(import.meta.url));
const _mdPath=join(__dir,"..","..","docs","AGENT_INSTRUCTIONS.md");
let _cached=null;
export function getInstructions(){if(!_cached)try{_cached=readFileSync(_mdPath,"utf-8")}catch{_cached="# Agent Instructions\n\nFile not found: "+_mdPath}return _cached}
export const AGENT_INSTRUCTIONS=getInstructions();