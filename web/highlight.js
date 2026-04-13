// @ctx .context/web/highlight.ctx
const t=new Set(["async","await","break","case","catch","class","const","continue","debugger","default","delete","do","else","export","extends","finally","for","from","function","if","import","in","instanceof","let","new","of","return","super","switch","this","throw","try","typeof","var","void","while","with","yield","static","get","set"]),n=new Set(["true","false","null","undefined","NaN","Infinity"]),s=new Set(["console","document","window","global","process","module","require","Promise","Array","Object","String","Number","Boolean","Map","Set","WeakMap","WeakSet","Symbol","RegExp","Error","JSON","Math","Date","parseInt","parseFloat","setTimeout","setInterval","clearTimeout","clearInterval","fetch","URL","Buffer","EventTarget","CustomEvent","HTMLElement","requestAnimationFrame","queueMicrotask"]);function e(t){return"&"===t?"&amp;":"<"===t?"&lt;":">"===t?"&gt;":t}
export function highlight(i){const l=[],f=i.length;
let h=0;for(;h<f;){const g=i[h];if("/"===g&&"/"===i[h+1]){const t=h;for(;h<f&&"\n"!==i[h];)h++;l.push(`<span class="t-cm">${a(i,t,h)}</span>`);continue}if("/"===g&&"*"===i[h+1]){const t=h;for(h+=2;h<f&&("*"!==i[h]||"/"!==i[h+1]);)h++;h+=2;
const n=i.substring(t,h);n.startsWith("/**")?l.push(u(n)):l.push(`<span class="t-cm">${a(i,t,h)}</span>`);continue}if("'"===g||'"'===g){const t=h;for(h++;h<f&&i[h]!==g;)"\\"===i[h]&&h++,h++;h++,l.push(`<span class="t-str">${a(i,t,h)}</span>`);continue}if("`"===g){const t=h;for(h++;h<f&&"`"!==i[h];)"\\"===i[h]&&h++,h++;h++,l.push(`<span class="t-str">${a(i,t,h)}</span>`);continue}if(r(g)||"."===g&&h+1<f&&r(i[h+1])){const t=h;if("0"!==g||"x"!==i[h+1]&&"X"!==i[h+1])for(;h<f&&(r(i[h])||"."===i[h]||"e"===i[h]||"E"===i[h]||"_"===i[h]);)h++;else for(h+=2;h<f&&o(i[h]);)h++;h<f&&"n"===i[h]&&h++,l.push(`<span class="t-num">${a(i,t,h)}</span>`);continue}if(c(g)){const g=h;for(;h<f&&p(i[h]);)h++;
const m=i.substring(g,h);
let d=h;for(;d<f&&" "===i[d];)d++;t.has(m)?l.push(`<span class="t-kw">${m}</span>`):n.has(m)?l.push(`<span class="t-lit">${m}</span>`):s.has(m)?l.push(`<span class="t-bi">${m}</span>`):"("===i[d]?l.push(`<span class="t-fn">${m}</span>`):g>0&&"."===i[g-1]?l.push(`<span class="t-prop">${m}</span>`):l.push(m);continue}l.push(e(g)),h++}return l.join("")}
function a(t,n,s){let i="";for(let l=n;l<s;l++)i+=e(t[l]);return i}
function r(t){return t>="0"&&t<="9"}
function o(t){return r(t)||t>="a"&&t<="f"||t>="A"&&t<="F"}
function c(t){return t>="a"&&t<="z"||t>="A"&&t<="Z"||"_"===t||"$"===t}
function p(t){return c(t)||r(t)}
function u(t){return'<span class="t-jd">'+t.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/(@\w+)/g,'<span class="t-jd-tag">$1</span>').replace(/\{([^}]+)\}/g,'<span class="t-jd-type">{$1}</span>')+"</span>"}

/** Markdown → HTML renderer */
export function renderMarkdown(src, basePath) {
  const esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const lines = src.split('\n');
  const out = [];
  let inCode = false, codeLang = '', codeLines = [];
  let inList = false, listType = '';

  function closeList() {
    if (inList) { out.push(listType === 'ul' ? '</ul>' : '</ol>'); inList = false; }
  }

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];

    // Fenced code blocks
    if (raw.trimStart().startsWith('```')) {
      if (inCode) {
        out.push(`<pre class="md-code-block"><code>${esc(codeLines.join('\n'))}</code></pre>`);
        inCode = false; codeLines = [];
      } else {
        closeList();
        inCode = true;
        codeLang = raw.trim().slice(3).trim();
        codeLines = [];
      }
      continue;
    }
    if (inCode) { codeLines.push(raw); continue; }

    const trimmed = raw.trim();
    if (!trimmed) { closeList(); out.push(''); continue; }

    // Headings
    const hm = trimmed.match(/^(#{1,6})\s+(.+)/);
    if (hm) {
      closeList();
      const level = hm[1].length;
      out.push(`<h${level} class="md-h">${inline(hm[2])}</h${level}>`);
      continue;
    }

    // Horizontal rule
    if (/^[-*_]{3,}\s*$/.test(trimmed)) {
      closeList();
      out.push('<hr class="md-hr">');
      continue;
    }

    // Blockquote
    if (trimmed.startsWith('> ')) {
      closeList();
      out.push(`<blockquote class="md-quote">${inline(trimmed.slice(2))}</blockquote>`);
      continue;
    }

    // Unordered list
    const ulm = trimmed.match(/^[-*+]\s+(.+)/);
    if (ulm) {
      if (!inList || listType !== 'ul') { closeList(); out.push('<ul class="md-list">'); inList = true; listType = 'ul'; }
      out.push(`<li>${inline(ulm[1])}</li>`);
      continue;
    }

    // Ordered list
    const olm = trimmed.match(/^\d+[.)]\s+(.+)/);
    if (olm) {
      if (!inList || listType !== 'ol') { closeList(); out.push('<ol class="md-list">'); inList = true; listType = 'ol'; }
      out.push(`<li>${inline(olm[1])}</li>`);
      continue;
    }

    // Table detection
    if (trimmed.includes('|') && i + 1 < lines.length && /^\|?\s*[-:]+/.test(lines[i+1].trim())) {
      closeList();
      const headers = trimmed.split('|').map(c => c.trim()).filter(Boolean);
      i++; // skip separator
      out.push('<table class="md-table"><thead><tr>');
      headers.forEach(h => out.push(`<th>${inline(h)}</th>`));
      out.push('</tr></thead><tbody>');
      while (i + 1 < lines.length && lines[i+1].trim().includes('|')) {
        i++;
        const cells = lines[i].trim().split('|').map(c => c.trim()).filter(Boolean);
        out.push('<tr>');
        cells.forEach(c => out.push(`<td>${inline(c)}</td>`));
        out.push('</tr>');
      }
      out.push('</tbody></table>');
      continue;
    }

    // Paragraph
    closeList();
    out.push(`<p class="md-p">${inline(trimmed)}</p>`);
  }

  // Close any open code block
  if (inCode) {
    out.push(`<pre class="md-code-block"><code>${esc(codeLines.join('\n'))}</code></pre>`);
  }
  closeList();

  return out.join('\n');

  function inline(text) {
    return esc(text)
      // Images: ![alt](src)
      .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, src) => {
        const resolved = resolveImagePath(src, basePath);
        return `<img class="md-img" src="${resolved}" alt="${alt}" loading="lazy">`;
      })
      // Links: [text](url)
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a class="md-link" href="$2" target="_blank">$1</a>')
      // Bold: **text** or __text__
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/__(.+?)__/g, '<strong>$1</strong>')
      // Italic: *text* or _text_
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/_(.+?)_/g, '<em>$1</em>')
      // Inline code: `code`
      .replace(/`([^`]+)`/g, '<code class="md-inline-code">$1</code>')
      // Strikethrough: ~~text~~
      .replace(/~~(.+?)~~/g, '<del>$1</del>');
  }

  function resolveImagePath(src, base) {
    if (src.startsWith('http://') || src.startsWith('https://') || src.startsWith('data:')) return src;
    // Relative path → /api/raw-file
    const dir = base ? base.substring(0, base.lastIndexOf('/') + 1) : '';
    const full = dir + src;
    return `/api/image?path=${encodeURIComponent(full)}`;
  }
}

/** SQL highlighter */
export function highlightSQL(src) {
  const kw = new Set(['SELECT','FROM','WHERE','INSERT','INTO','VALUES','UPDATE','SET','DELETE','CREATE','ALTER','DROP','TABLE','INDEX','IF','NOT','EXISTS','PRIMARY','KEY','REFERENCES','DEFAULT','NULL','ON','AND','OR','IN','AS','JOIN','LEFT','RIGHT','INNER','OUTER','GROUP','BY','ORDER','HAVING','LIMIT','OFFSET','UNION','ALL','DISTINCT','CASE','WHEN','THEN','ELSE','END','CASCADE','SERIAL','CONSTRAINT','UNIQUE','CHECK','FOREIGN','INTEGER','INT','VARCHAR','TEXT','BOOLEAN','TIMESTAMP','JSONB','JSON','BIGINT','SMALLINT','NUMERIC','FLOAT','DOUBLE','DECIMAL','DATE','TIME','NOW','WITH','RECURSIVE','RETURNING']);
  return src.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/--.*/g, m => `<span class="t-cm">${m}</span>`)
    .replace(/'[^']*'/g, m => `<span class="t-str">${m}</span>`)
    .replace(/\b\d+\b/g, m => `<span class="t-num">${m}</span>`)
    .replace(/\b[A-Z_]{2,}\b/g, m => kw.has(m) ? `<span class="t-kw">${m}</span>` : m);
}

/** Generic plain-text highlighter (no colors, just escape) */
export function highlightPlain(src) {
  return src.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}