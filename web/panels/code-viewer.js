// @ctx .context/web/panels/code-viewer.ctx
import e from"@symbiotejs/symbiote";import{api as n,events as t,state as o,formatStats}from"../app.js";import"../components/code-block.js";

const _extLang={'.md':'md','.markdown':'md','.sql':'sql','.json':'json','.css':'css','.html':'html','.htm':'html','.xml':'xml','.yaml':'yaml','.yml':'yaml','.toml':'toml','.sh':'sh','.bash':'bash','.env':'env','.ini':'ini','.conf':'conf','.cfg':'cfg','.txt':'plain','.csv':'csv','.gitignore':'plain','.dockerignore':'plain','.editorconfig':'plain','.png':'image','.jpg':'image','.jpeg':'image','.gif':'image','.svg':'image','.webp':'image','.bmp':'image','.ico':'image','.pdf':'binary','.zip':'binary','.tar':'binary','.gz':'binary','.woff':'binary','.woff2':'binary','.ttf':'binary','.eot':'binary','.mp3':'binary','.mp4':'binary','.wav':'binary','.avi':'binary','.mov':'binary'};
function _getLang(path){if(!path)return'js';const i=path.lastIndexOf('.');if(i<0){const base=path.split('/').pop()||'';if(['Dockerfile','Makefile','Procfile','LICENSE','README','CHANGELOG'].some(n=>base.startsWith(n)))return'plain';return'plain'}return _extLang[path.substring(i).toLowerCase()]||'js'}

// Two operational modes for JS files:
//
// MODE A — Readable source (normal projects like 1sim_local):
//   Source file is human-written, readable code.
//   Toggle button label: "COMPACT" — shows Terser-compressed view.
//   _isReadable = true (compression saves >15% tokens)
//
// MODE B — Compact source (compact projects like project-graph-mcp):
//   Source file is already minified/compressed on disk.
//   Toggle button label: "EXPAND" — beautifies via Terser + injects JSDoc from .ctx.
//   _isReadable = false (compression saves <15% — already compact)

export class CodeViewer extends e{init$={filename:"Select a file",hasFile:!1,viewMode:"source",modeLabel:"source",statsText:"",showToggle:!1,toggleLabel:"",onShowInGraph:()=>{
  if(!this._currentPath)return;
  window.location.hash = `#graph?focus=${encodeURIComponent(this._currentPath)}`;
},onToggleMode:()=>{
  const lang=_getLang(this._currentPath);
  if(lang==='md'){
    this.$.viewMode=this.$.viewMode==="rendered"?"raw":"rendered";
    this._showCurrentMode();
    return;
  }
  // Toggle between source and the transformation
  this.$.viewMode=this.$.viewMode==="source"?"transformed":"source";
  this._showCurrentMode();
}};_fileData=null;_isReadable=!1;_transformCache=null;_loadingTransform=!1;_currentPath=null;initCallback(){t.addEventListener("file-selected",e=>this._loadFile(e.detail.path));if(o.activeFile)requestAnimationFrame(()=>this._loadFile(o.activeFile))}renderCallback(){this.sub("hasFile",e=>{this.toggleAttribute("has-file",e)}),this.sub("viewMode",e=>{
  const lang=_getLang(this._currentPath);
  this.toggleAttribute("mode-raw","source"!==e);
  if(lang==='md'){
    this.$.modeLabel=e==="rendered"?"rendered":"source";
  }else{
    this.$.modeLabel=e==="source"?"source":(this._isReadable?"compact":"expanded");
  }
})}_getCodeBlock(){return this.querySelector("code-block")}async _showCurrentMode(){if(!this._fileData)return;const e=this._getCodeBlock();if(!e)return;
const lang=_getLang(this._currentPath);
if(lang==='md'){
  if(this.$.viewMode==="rendered"){
    e.$.lang='md';
    e.setBasePath(this._currentPath);
    e.$.code=this._fileData.raw;
  }else{
    e.$.lang='plain';
    e.$.code=this._fileData.raw;
  }
  return;
}
e.$.lang=lang;
if("transformed"===this.$.viewMode){
  // Show cached transform if available
  if(this._transformCache){
    e.$.code=this._transformCache;
    if(this._transformStatsText) this.$.statsText=this._transformStatsText;
    return;
  }
  if(this._loadingTransform)return;
  this._loadingTransform=!0;
  e.$.code=this._isReadable?"// Compressing...":"// Expanding...";
  try{
      if(this._isReadable){
        // MODE A: readable source → compress
        const t=await n("/api/compact-file",{path:this._currentPath});
        this._transformCache=t?.code||"// Compression unavailable";
        this._transformStatsText=t?`Compressed: ${(t.compressed/1000).toFixed(1)}K chars (${t.savings})`:"";
      }else{
        // MODE B: compact source → expand (beautify + inject JSDoc from .ctx)
        const t=await n("/api/expand-file",{path:this._currentPath});
        this._transformCache=t?.code||"// Expand unavailable";
        this._transformStatsText=t?`Expanded: ${(t.decompiled/1000).toFixed(1)}K chars | JSDocs injected: ${t.injected||0}`:"";
      }
      if(this._transformStatsText)this.$.statsText=this._transformStatsText;
    e.$.code=this._transformCache;
  }catch{e.$.code=this._isReadable?"// Compression failed":"// Expand failed"}
  finally{this._loadingTransform=!1}
  return;
}
// Source mode — raw file as-is
this.$.statsText=this._baseStatsText;
e.$.code=this._fileData.raw;
}async _loadFile(e){this.$.filename=e,this.$.hasFile=!1,this._fileData=null,this.$.statsText="",this._baseStatsText="",this._transformStatsText="",this._transformCache=null,this._currentPath=e;
const lang=_getLang(e);
if(lang==='image'){
  const i=this._getCodeBlock();
  if(i){i.$.lang='image';i.setBasePath(e);i.$.code=e}
  this.$.viewMode="rendered";
  this.$.modeLabel="image";
  this.$.showToggle=!1;
  this.$.hasFile=!0;
  return;
}
if(lang==='binary'){
  const i=this._getCodeBlock();
  if(i){i.$.lang='plain';i.$.code=`// Binary file: ${e}\n// Cannot display binary content`}
  this.$.viewMode="source";
  this.$.modeLabel="binary";
  this.$.showToggle=!1;
  this.$.hasFile=!0;
  return;
}
try{const[t,_raw]=await Promise.all([n("/api/file",{path:e}),n("/api/raw-file",{path:e}).catch(()=>null)]);const o="string"==typeof t.code?t.code:"string"==typeof t.compressed?t.compressed:t.content||JSON.stringify(t,null,2);
let s=_raw?.content||o;
// Detect mode: if .ctx documentation exists (ctxTok > 0), source is compact → EXPAND available
// If no .ctx, source is readable → COMPACT available
const hasCtx=!!(t.ctxTok&&t.ctxTok>0);
this._isReadable=!hasCtx;
this._fileData={compact:o,raw:s,codeTok:t.codeTok||0,ctxTok:t.ctxTok||0,totalTok:t.totalTok||0,expanded:t.expanded||0,savings:t.savings||"0%"};
this._baseStatsText=t.codeTok&&t.expanded?formatStats(t):"";
this.$.statsText=this._baseStatsText;
const i=this._getCodeBlock();
if(lang==='md'){
  this.$.viewMode="rendered";
  this.$.modeLabel="rendered";
  this.$.showToggle=!0;
  this.$.toggleLabel="source";
  if(i){i.$.lang='md';i.setBasePath(e);i.$.code=s}
}else{
  i&&(i.$.lang=lang);
  // Always start in SOURCE mode
  this.$.viewMode="source";
  this.$.modeLabel="source";
  // Toggle: readable → COMPACT button, compact → EXPAND button
  this.$.showToggle=!0;
  this.$.toggleLabel=this._isReadable?"compact":"expand";
  i&&(i.$.code=s);
}
this.$.hasFile=!0}catch(e){const n=this._getCodeBlock();n&&(n.$.lang='plain',n.$.code=`// Error: ${e.message}`),this.$.showToggle=!1,this.$.hasFile=!0}}}

CodeViewer.template=`
  <div class="pg-code-header">
    <span class="pg-code-filename" bind="textContent: filename"></span>
    <div class="pg-code-controls">
      <span class="pg-code-stats" bind="textContent: statsText"></span>
      <button class="pg-mode-toggle" bind="onclick: onShowInGraph" title="Show in Graph">
        <span class="material-symbols-outlined" style="font-size:14px">account_tree</span>
        <span class="pg-mode-label">graph</span>
      </button>
      <button class="pg-mode-toggle" bind="onclick: onToggleMode; hidden: !showToggle" title="Toggle view mode">
        <span class="material-symbols-outlined" style="font-size:14px">compress</span>
        <span class="pg-mode-label" bind="textContent: modeLabel"></span>
      </button>
    </div>
  </div>
  <code-block></code-block>
`;

CodeViewer.rootStyles="\n  pg-code-viewer {\n    display: flex;\n    flex-direction: column;\n    height: 100%;\n    overflow: hidden;\n  }\n  pg-code-viewer:not([has-file]) code-block {\n    display: none;\n  }\n  .pg-code-header {\n    display: flex;\n    align-items: center;\n    justify-content: space-between;\n    padding: 6px 12px;\n    font-family: 'SF Mono', 'Fira Code', monospace;\n    font-size: 11px;\n    color: var(--sn-text-dim, hsl(30, 10%, 45%));\n    border-bottom: 1px solid var(--sn-node-border, hsl(35, 18%, 80%));\n    background: var(--sn-node-header-bg, hsl(37, 25%, 93%));\n    gap: 8px;\n  }\n  .pg-code-filename {\n    white-space: nowrap;\n    overflow: hidden;\n    text-overflow: ellipsis;\n    min-width: 0;\n  }\n  .pg-code-controls {\n    display: flex;\n    align-items: center;\n    gap: 8px;\n    flex-shrink: 0;\n  }\n  .pg-code-stats {\n    font-size: 10px;\n    color: var(--sn-cat-server, hsl(210, 45%, 45%));\n    white-space: nowrap;\n  }\n  .pg-mode-toggle {\n    display: flex;\n    align-items: center;\n    gap: 3px;\n    padding: 2px 8px;\n    border: 1px solid var(--sn-node-border, hsl(35, 18%, 80%));\n    border-radius: 4px;\n    background: var(--sn-bg, hsl(37, 30%, 91%));\n    color: var(--sn-text-dim, hsl(30, 10%, 45%));\n    font-family: inherit;\n    font-size: 10px;\n    cursor: pointer;\n    text-transform: uppercase;\n    letter-spacing: 0.5px;\n    transition: all 120ms ease;\n  }\n  .pg-mode-toggle:hover {\n    background: var(--sn-node-hover, hsl(36, 22%, 88%));\n    color: var(--sn-text, hsl(30, 15%, 18%));\n  }\n  pg-code-viewer[mode-raw] .pg-mode-toggle {\n    background: hsla(210, 45%, 45%, 0.12);\n    border-color: var(--sn-cat-server, hsl(210, 45%, 45%));\n    color: var(--sn-cat-server, hsl(210, 45%, 45%));\n  }\n  .pg-mode-toggle[hidden] {\n    display: none;\n  }\n  code-block {\n    flex: 1;\n    min-height: 0;\n  }\n";
CodeViewer.reg("pg-code-viewer");