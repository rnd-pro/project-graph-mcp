export function minifyLegend(s) {
  const t = {}, o = new Set;
  for (const n of s) {
    let s = e(n), c = 1;
    for (;o.has(s); ) s = e(n) + c, c++;
    o.add(s), t[n] = s;
  }
  return t;
}

function e(e) {
  const s = e.replace(/[a-z]/g, "");
  if (s.length >= 2) return s.slice(0, 3);
  const t = e.match(/[A-Z]/g);
  return t && t.length > 0 ? e[0].toLowerCase() + t[0] : e.slice(0, 2);
}

const WEB_LIMIT = 16;

function compactList(e, s = WEB_LIMIT) {
  return [ ...new Set((e || []).map(e => String(e || "").trim()).filter(Boolean)) ].slice(0, s);
}

function compactWeb(e) {
  const s = {
    tag: e.tag || void 0,
    file: e.file || void 0,
    template: e.template || void 0,
    style: e.style || void 0,
    children: compactList(e.children),
    refs: compactList(e.refs),
    bindings: compactList(e.bindings),
    events: compactList([ ...(e.templateEvents || []), ...(e.eventListeners || []) ]),
    dispatches: compactList(e.dispatches),
    subscriptions: compactList(e.subscriptions),
    itemTags: compactList(e.itemTags),
    tokens: compactList(e.cssTokens)
  };
  for (const [e, t] of Object.entries(s)) (Array.isArray(t) && 0 === t.length || void 0 === t) && delete s[e];
  return s;
}

export function buildGraph(e) {
  const s = e.classes || [], t = e.functions || [], o = [ ...s.map(e => e.name), ...t.map(e => e.name), ...s.flatMap(e => e.methods || []) ], n = minifyLegend([ ...new Set(o) ]), c = Object.fromEntries(Object.entries(n).map(([e, s]) => [ s, e ])), _webByClass = new Map((e.web || []).map(e => [ `${e.file}:${e.className}`, e ])), _fileImports = e.fileImports || {}, f = {
    v: 1,
    legend: n,
    reverseLegend: c,
    stats: {
      files: (e.files || []).length,
      classes: s.length,
      functions: t.length,
      tables: (e.tables || []).length
    },
    nodes: {},
    edges: [],
    orphans: [],
    duplicates: {},
    files: e.files || [],
    fileImports: _fileImports,
    web: {}
  };
  for (const e of s) {
    const s = n[e.name], _imports = e.imports?.length ? e.imports : (_fileImports[e.file] || []).map(e => e.s).filter(Boolean), _web = _webByClass.get(`${e.file}:${e.name}`);
    f.nodes[s] = {
      t: "C",
      x: e.extends || void 0,
      m: (e.methods || []).map(e => n[e] || e),
      $: (e.properties || []).length ? e.properties : void 0,
      i: _imports.length ? _imports : void 0,
      f: e.file || void 0,
      l: e.line || void 0
    };
    if (_web) {
      const e = compactWeb(_web);
      f.nodes[s].w = e, f.web[s] = e;
    }
    for (const t of e.calls || []) if (t.includes(".")) {
      const [e, o] = t.split(".");
      if (n[e]) {
        const t = [ s, "→", `${n[e]}.${n[o] || o}` ];
        f.edges.push(t);
      }
    } else if (n[t]) {
      const e = [ s, "→", n[t] ];
      f.edges.push(e);
    }
  }
  for (const e of t) {
    const s = n[e.name];
    f.nodes[s] = {
      t: "F",
      e: e.exported,
      f: e.file || void 0,
      l: e.line || void 0
    };
    for (const t of e.dbReads || []) f.edges.push([ s, "R→", t ]);
    for (const t of e.dbWrites || []) f.edges.push([ s, "W→", t ]);
  }
  for (const e of s) {
    const s = n[e.name];
    for (const t of e.dbReads || []) f.edges.push([ s, "R→", t ]);
    for (const t of e.dbWrites || []) f.edges.push([ s, "W→", t ]);
  }
  for (const s of e.tables || []) f.nodes[s.name] = {
    t: "T",
    cols: s.columns.map(e => e.name),
    f: s.file || void 0
  };
  const _tagToAlias = {};
  for (const [e, s] of Object.entries(f.web)) s.tag && (_tagToAlias[s.tag] = e);
  for (const [e, s] of Object.entries(f.web)) {
    for (const t of [ s.template, s.style ].filter(Boolean)) f.edges.push([ e, "F→", t ]);
    for (const t of s.children || []) _tagToAlias[t] && _tagToAlias[t] !== e && f.edges.push([ e, "E→", _tagToAlias[t] ]);
  }
  const l = new Set;
  for (const e of f.edges) {
    const s = e[2].split(".")[0];
    l.add(s);
  }
  for (const e of Object.keys(f.nodes)) l.has(e) || "F" !== f.nodes[e].t || f.nodes[e].e || f.orphans.push(c[e]);
  const i = Object.create(null);
  for (const e of s) for (const s of e.methods || []) i[s] || (i[s] = []), i[s].push(`${e.name}:${e.line}`);
  for (const [e, s] of Object.entries(i)) s.length > 1 && (f.duplicates[e] = s);
  return f;
}

export function createSkeleton(e, s = null) {
  const t = {}, o = {};
  for (const [s, n] of Object.entries(e.legend)) {
    const c = e.nodes[n];
    if (c && "C" === c.t) {
      const e = c.m?.length || 0, f = c.$?.length || 0;
      if (0 === e && 0 === f) continue;
      t[n] = s;
      const l = {
        m: e
      };
      f > 0 && (l.$ = f), c.f && (l.f = c.f), c.l && (l.l = c.l), o[n] = l;
    }
  }
  const n = {};
  for (const [s, o] of Object.entries(e.legend)) {
    const c = e.nodes[o];
    if ("F" === c?.t && c.e) {
      t[o] = s;
      const f = c.f || "?";
      n[f] || (n[f] = []);
      n[f].push(o);
    }
  }
  const c = new Set;
  for (const e of Object.values(o)) e.f && c.add(e.f);
  for (const e of Object.keys(n)) c.add(e);
  const f = {};
  for (const s of e.files || []) {
    if (c.has(s)) continue;
    const e = s.lastIndexOf("/"), t = e >= 0 ? s.slice(0, e + 1) : "./", o = e >= 0 ? s.slice(e + 1) : s;
    f[t] || (f[t] = []), f[t].push(o);
  }
  const l = {
    v: e.v,
    L: t,
    s: e.stats,
    n: o,
    X: n,
    e: e.edges.length,
    o: e.orphans.length,
    d: Object.keys(e.duplicates).length
  };
  if (Object.keys(f).length > 0 && (l.f = f), s && s.length > 0) {
    const t = new Set(e.files || []), o = s.filter(e => !t.has(e));
    if (o.length > 0) {
      const e = {};
      for (const s of o) {
        const t = s.lastIndexOf("/"), o = t >= 0 ? s.slice(0, t + 1) : "./", n = t >= 0 ? s.slice(t + 1) : s;
        e[o] || (e[o] = []), e[o].push(n);
      }
      l.a = e;
    }
  }
  const _fi = e.fileImports || {};
  if (Object.keys(_fi).length > 0) {
    const _I = {};
    for (const [_file, _sources] of Object.entries(_fi)) {
      const _compact = _sources.map(s => s.s);
      if (_compact.length > 0) _I[_file] = _compact;
    }
    if (Object.keys(_I).length > 0) l.I = _I;
  }
  if (Object.keys(e.web || {}).length > 0) l.W = e.web;
  return l;
}
