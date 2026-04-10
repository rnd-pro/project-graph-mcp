/**
 * Minimal JS syntax highlighter — state-machine tokenizer
 * No dependencies. Produces HTML with span.token-* classes.
 *
 * Handles: keywords, strings, template literals, comments,
 * numbers, regex, function calls, properties, built-ins.
 *
 * @param {string} code - Raw JavaScript source
 * @returns {string} HTML with syntax highlighting spans
 */

const KEYWORDS = new Set([
  'async','await','break','case','catch','class','const','continue',
  'debugger','default','delete','do','else','export','extends','finally',
  'for','from','function','if','import','in','instanceof','let','new',
  'of','return','super','switch','this','throw','try','typeof','var',
  'void','while','with','yield','static','get','set',
]);

const LITERALS = new Set(['true', 'false', 'null', 'undefined', 'NaN', 'Infinity']);

const BUILT_INS = new Set([
  'console','document','window','global','process','module','require',
  'Promise','Array','Object','String','Number','Boolean','Map','Set',
  'WeakMap','WeakSet','Symbol','RegExp','Error','JSON','Math','Date',
  'parseInt','parseFloat','setTimeout','setInterval','clearTimeout',
  'clearInterval','fetch','URL','Buffer','EventTarget','CustomEvent',
  'HTMLElement','requestAnimationFrame','queueMicrotask',
]);

function esc(ch) {
  if (ch === '&') return '&amp;';
  if (ch === '<') return '&lt;';
  if (ch === '>') return '&gt;';
  return ch;
}

export function highlight(code) {
  const out = [];
  const len = code.length;
  let i = 0;

  while (i < len) {
    const ch = code[i];

    // ── Line comment ──
    if (ch === '/' && code[i + 1] === '/') {
      const start = i;
      while (i < len && code[i] !== '\n') i++;
      out.push(`<span class="t-cm">${escRange(code, start, i)}</span>`);
      continue;
    }

    // ── Block comment ──
    if (ch === '/' && code[i + 1] === '*') {
      const start = i;
      i += 2;
      while (i < len && !(code[i] === '*' && code[i + 1] === '/')) i++;
      i += 2;
      out.push(`<span class="t-cm">${escRange(code, start, i)}</span>`);
      continue;
    }

    // ── String: single/double quotes ──
    if (ch === "'" || ch === '"') {
      const start = i;
      i++;
      while (i < len && code[i] !== ch) {
        if (code[i] === '\\') i++;
        i++;
      }
      i++; // closing quote
      out.push(`<span class="t-str">${escRange(code, start, i)}</span>`);
      continue;
    }

    // ── Template literal ──
    if (ch === '`') {
      const start = i;
      i++;
      while (i < len && code[i] !== '`') {
        if (code[i] === '\\') i++;
        i++;
      }
      i++; // closing backtick
      out.push(`<span class="t-str">${escRange(code, start, i)}</span>`);
      continue;
    }

    // ── Number ──
    if (isDigit(ch) || (ch === '.' && i + 1 < len && isDigit(code[i + 1]))) {
      const start = i;
      if (ch === '0' && (code[i + 1] === 'x' || code[i + 1] === 'X')) {
        i += 2;
        while (i < len && isHexDigit(code[i])) i++;
      } else {
        while (i < len && (isDigit(code[i]) || code[i] === '.' || code[i] === 'e' || code[i] === 'E' || code[i] === '_')) i++;
      }
      if (i < len && code[i] === 'n') i++; // BigInt
      out.push(`<span class="t-num">${escRange(code, start, i)}</span>`);
      continue;
    }

    // ── Identifier / keyword ──
    if (isIdentStart(ch)) {
      const start = i;
      while (i < len && isIdentPart(code[i])) i++;
      const word = code.substring(start, i);

      // Look ahead: is this a function call?
      let j = i;
      while (j < len && code[j] === ' ') j++;

      if (KEYWORDS.has(word)) {
        out.push(`<span class="t-kw">${word}</span>`);
      } else if (LITERALS.has(word)) {
        out.push(`<span class="t-lit">${word}</span>`);
      } else if (BUILT_INS.has(word)) {
        out.push(`<span class="t-bi">${word}</span>`);
      } else if (code[j] === '(') {
        out.push(`<span class="t-fn">${word}</span>`);
      } else if (start > 0 && code[start - 1] === '.') {
        out.push(`<span class="t-prop">${word}</span>`);
      } else {
        out.push(word);
      }
      continue;
    }

    // ── Operator / punctuation / whitespace ──
    out.push(esc(ch));
    i++;
  }

  return out.join('');
}

function escRange(code, start, end) {
  let s = '';
  for (let i = start; i < end; i++) s += esc(code[i]);
  return s;
}

function isDigit(ch) { return ch >= '0' && ch <= '9'; }
function isHexDigit(ch) { return isDigit(ch) || (ch >= 'a' && ch <= 'f') || (ch >= 'A' && ch <= 'F'); }
function isIdentStart(ch) { return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_' || ch === '$'; }
function isIdentPart(ch) { return isIdentStart(ch) || isDigit(ch); }
