const fs = require('fs');

const mappings = {
  'compress.ctx': `
@names estimateTokens:e=code
@names extractLegend:e=sourceCode,n=filePath,a=lines,t=ast,s=jsdoc
@names compressFile:t=filePath,s=options,r=beautify,i=legend,c=ext,l=sourceCode,m=originalTokens,d=terserOptions,p=compressedCode,e=minifiedResult,f=extractedLegend,u=finalCode,y=compressedTokens
@names editCompressed:t=filePath,n=symbolName,r=newCode,o=options,i=beautify,c=dryRun,l=sourceCode,m=ast,d=symbolRange,p=modifiedCode,e=minifiedResult
@names findSymbolRange:e=ast,t=sourceCode,n=symbolName,a=symbolRange`,
};

for (const [file, names] of Object.entries(mappings)) {
  const path = \`.context/src/compact/\${file}\`;
  if (!fs.existsSync(path)) continue;
  let content = fs.readFileSync(path, 'utf-8');
  if (content.includes('@names ')) continue;
  content = content.replace(/(?=PATTERNS:|EDGE_CASES:)/, names.trim() + '\n');
  fs.writeFileSync(path, content);
  console.log('Updated ' + file);
}
