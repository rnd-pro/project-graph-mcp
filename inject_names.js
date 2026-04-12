const fs = require('fs');

const mappings = {
  'src/network/backend.js': `
 @names __top__:t=projectPath,c=server,a=intervalId,e=address`,
  'src/network/backend-lifecycle.js': `
 @names __top__:m=dirName,g=registryDir
 @names getPortFilePath:t=projectPath,r=resolvedPath,o=hash
 @names readPortFile:e=projectPath,t=filePath
 @names writePortFile:e=projectPath,t=port,r=resolvedPath,n=portData
 @names removePortFile:e=projectPath
 @names listBackends:e=files,t=backends,r=file
 @names ensureBackend:e=projectPath,t=resolvedPath,o=portData,n=backendScript,c=portFilePath,s=startTime
 @names startStdioProxy:e=port,r=initialMessages,o=wsKey,n=tcpClient,c=handshakeDone,s=buffer,i=messageQueue,a=rl
 @names encodeClientFrame:e=data,r=payload,o=mask,n=maskedPayload,c=header
 @names decodeFrame:e=buffer,t=opcode,r=payloadLength,o=offset`,
  'src/network/local-gateway.js': `
 @names __top__:s=baseDir,i=registryPath,a=pidPath
 @names writeRegistry:e=registry
 @names registerService:e=domain,t=port,r=options,n=hostname,s=registry,o=routePath,i=mdnsService,a=gatewayPort,c=portSuffix,p=serviceUrl
 @names resolveBackend:e=hostname,t=url,r=registry,n=service,o=rewritePath
 @names readGatewayPid:e=fileContent
 @names isGatewayRunning:e=pidInfo
 @names getGatewayPort:e=pidInfo
 @names ensureGateway:n=server,t=req,r=res,o=registry,s=backend,i=proxyReq,e=error,a=clientSocket,c=proxySocket
 @names startListening:e=listenPort`,
  'src/network/mdns.js': `
 @names __top__:r=mcastIp
 @names registerLocal:t=hostname,e=port
 @names registerDnsSd:e=hostname,r=port,n=childProcess
 @names tryAvahi:e=hostname,r=childProcess,n=failed
 @names registerMcast:t=hostname,n=parts,c=packetName,e=partBuf,o=socket,i=classType,s=response,a=offset`,
  'src/network/server.js': `
 @names __top__:o=command,r=args,t=dir,s=port,c=rl,a=pendingMessages,l=resolved,p=rootsRequestId,d=initializeId,n=debugLog
 @names startProxy:e=projectPath,t=backendPort`,
  'src/network/web-server.js': `
 @names __top__:d=dirName,p=rootDir,m=webDir,h=modulePaths,u=mimeType
 @names serveStatic:e=reqPath,n=res,a=normalized,s=vendorMatch,r=filePath,c=modulePath,i=ext,l=mime,d=fileData
 @names computeWSAccept:e=key
 @names encodeWSFrame:e=data,t=payload,o=len,n=header
 @names decodeWSFrame:e=buffer,t=opcode,o=masked,n=payloadLength,a=offset,s=payload
 @names startWebServer:t=projectPath,a=port,d=mcp,p=projectName,m=agentIdCounter,h=resolvedPath,u=hash,g=hue,f=state,w=agents,y=uiClients,S=shutdownTimer,v=httpServer,j=wsServer,b=isAutoPort,T=listenPort
 @names broadcastRPC:e=method,t=params,o=message
 @names patchState:e=path,t=value,o=parts,n=current
 @names handleAPI:e=pathname,a=searchParams,s=method,r=res,c=response,i=targetPath`
};

for (const [file, namesStr] of Object.entries(mappings)) {
  const dir = require('path').dirname(file);
  const base = require('path').basename(file, '.js');
  const targetPath = ".context/" + dir + "/" + base + ".ctx";
  if (!fs.existsSync(targetPath)) continue;
  
  let content = fs.readFileSync(targetPath, 'utf-8');
  
  // Remove existing @names lines
  content = content.replace(/^ ?@names .*\n?/gm, '');
  
  let names = namesStr.trim();
  
  // Insert before PATTERNS: or EDGE_CASES: or append at the end
  if (content.match(/(?=PATTERNS:|EDGE_CASES:)/)) {
    content = content.replace(/(?=PATTERNS:|EDGE_CASES:)/, names + '\n');
  } else {
    content += '\n' + names;
  }
  
  fs.writeFileSync(targetPath, content);
  console.log('Updated ' + file);
}