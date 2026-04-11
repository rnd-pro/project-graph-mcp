#!/usr/bin/env node
import{resolve as e}from"node:path";import{startWebServer as o}from"./web-server.js";import{writePortFile as s,removePortFile as r}from"./backend-lifecycle.js";
const c=e(process.argv[2]||".");function cleanup(){r(c)}process.on("exit",cleanup),process.on("SIGINT",()=>{cleanup(),process.exit()}),process.on("SIGTERM",()=>{cleanup(),process.exit()});
const n=o(c,0),p=setInterval(()=>{const e=n.address();e&&(clearInterval(p),s(c,e.port))},50);