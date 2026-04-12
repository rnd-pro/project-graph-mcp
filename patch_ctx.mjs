import fs from 'fs';

const mappings = {
  'mcp-server.ctx': `
@names createServer:s=sendFn,n=requestId,i=pendingRequests,c=isInitialized,e=pendingRequest,a=methodName,r=methodParams,t=toolArgs,o=handlerMap
@names startStdioServer:e=initialMessages,t=server,s=readline,o=response
@names __top__:e=args,t=projectRoot,s=graph,o=docs,a=guideContent,r=topicRegex,n=topicMatch,i=topicIndex,c=nextTopicIndex,d=globalCtxPath`,
  'tool-defs.ctx': `
@names __top__:e=TOOLS`,
  'tools.ctx': `
@names saveDiskCache:e=projectPath,t=graph,n=cacheFilePath,r=cacheData
@names loadDiskCache:e=projectPath,t=cacheFilePath,n=cacheContent,r=cacheData
@names getGraph:t=projectPath,n=projectAST
@names detectChanges:e=projectPath,t=jsFiles,r=currentFilesSet,s=cachedFilesSet
@names snapshotMtimes:e=projectPath,t=jsFiles
@names getSkeleton:e=projectPath,t=graph,n=allFiles
@names getFocusZone:e=options,n=targetPath,r=graph,s=recentFiles,o=expandedNodes,t=legendKey
@names expand:t=symbol,n=targetPath,r=graph,s=className,o=methodName,i=fullSymbolName,a=ast,l=classNode,f=functionNode,e=node
@names deps:e=symbol,t=targetPath,n=graph,r=node,s=incomingEdges,o=outgoingEdges
@names usages:t=symbol,n=targetPath,r=graph,s=ast,o=fullSymbolName,c=usagesList,e=classNode
@names extractMethod:e=fileContent,t=methodName,n=regexMatch,r=matchIndex,s=braceCount,o=currentIndex
@names getCallChain:e=options,t=startSymbol,n=endSymbol,r=targetPath,s=resolvedPath,o=graph,c=startFull,i=endFull,a=adjacencyList,l=queue,f=visitedNodes,u=visitedClasses`
};

for (const [file, names] of Object.entries(mappings)) {
  const path = `.context/src/mcp/${file}`;
  if (!fs.existsSync(path)) continue;
  let content = fs.readFileSync(path, 'utf-8');
  
  // Remove existing @names
  content = content.replace(/^@names .*\n/gm, '');

  const namesBlock = names.trim() + '\n';
  
  if (content.match(/(?=PATTERNS:|EDGE_CASES:)/)) {
    content = content.replace(/(?=PATTERNS:|EDGE_CASES:)/, namesBlock);
  } else {
    content += namesBlock;
  }
  
  fs.writeFileSync(path, content);
  console.log('Updated ' + file);
}
