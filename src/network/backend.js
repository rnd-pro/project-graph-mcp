#!/usr/bin/env node
// @ctx backend.ctx
import{resolve as e}from"node:path";import{startWebServer as r}from"./web-server.js";import{writePortFile as s,removePortFile as o}from"./backend-lifecycle.js";
const t=e(process.argv[2]||".");function cleanup(){o(t)}process.on("exit",cleanup),process.on("SIGINT",()=>{cleanup(),process.exit()}),process.on("SIGTERM",()=>{cleanup(),process.exit()});
const c=r(t,0),a=setInterval(()=>{const e=c.address();e&&(clearInterval(a),s(t,e.port))},50);