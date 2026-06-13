import { readFileSync as e, readdirSync as s, statSync as t, existsSync as n } from "fs";

import { join as r, relative as o, resolve as i, dirname as q } from "path";

import { parse as a } from "../../vendor/acorn.mjs";

import * as c from "../../vendor/walk.mjs";

import { shouldExcludeDir as l, shouldExcludeFile as p, parseGitignore as u } from "./filters.js";

import { parseTypeScript as f } from "../lang/lang-typescript.js";

import { parsePython as d } from "../lang/lang-python.js";

import { parseGo as m } from "../lang/lang-go.js";

import { parseSQL as h, extractSQLFromString as y, isSQLString as g } from "../lang/lang-sql.js";

const x = [ ".js", ".ts", ".tsx", ".py", ".go", ".sql" ];

export async function parseFile(e, s) {
  const t = {
    file: s,
    classes: [],
    functions: [],
    imports: [],
    exports: [],
    importSources: [],
    web: {
      registrations: [],
      eventListeners: [],
      dispatches: [],
      subscriptions: []
    }
  }, n = [];
  let r;
  try {
    r = a(e, {
      ecmaVersion: "latest",
      sourceType: "module",
      locations: !0,
      onComment: n
    });
  } catch (e) {
    return console.warn(`Parse error in ${s}:`, e.message), t;
  }
  const o = function(e, s) {
    const t = new Map;
    for (const n of e) {
      if ("Block" !== n.type || !n.value.startsWith("*")) continue;
      const e = "/*" + n.value + "*/", r = s.slice(0, n.end).split("\n").length, o = [], i = /@param\s+\{/g;
      let a;
      for (;null !== (a = i.exec(e)); ) {
        let s = 1, t = a.index + a[0].length;
        for (;t < e.length && s > 0; ) "{" === e[t] ? s++ : "}" === e[t] && s--, t++;
        if (0 !== s) continue;
        const n = e.slice(a.index + a[0].length, t - 1), r = e.slice(t).match(/^\s+(\[?\w+(?:\.\w+)*\]?)/);
        if (!r) continue;
        let i = r[1];
        i.startsWith("[") && (i = i.slice(1)), i.endsWith("]") && (i = i.slice(0, -1)),
        i.includes(".") || o.push({
          name: i,
          type: n
        });
      }
      let c = null;
      const l = e.match(/@returns?\s+\{([^}]+)\}/);
      l && (c = l[1]), (o.length > 0 || c) && t.set(r, {
        params: o,
        returns: c
      });
    }
    return t;
  }(n, e), i = new Set;
  c.simple(r, {
    ImportDeclaration(e) {
      const _names = [];
      for (const s of e.specifiers) "ImportDefaultSpecifier" === s.type ? (t.imports.push(s.local.name),
      _names.push(s.local.name)) : "ImportSpecifier" === s.type && (t.imports.push(s.imported.name),
      _names.push(s.imported.name));
      if (e.source && e.source.value) {
        t.importSources.push({
          s: e.source.value,
          n: _names
        });
      }
    },
    ExportNamedDeclaration(e) {
      if (e.declaration) if (e.declaration.id) i.add(e.declaration.id.name); else if (e.declaration.declarations) for (const s of e.declaration.declarations) i.add(s.id.name);
      if (e.specifiers) for (const s of e.specifiers) i.add(s.exported.name);
    },
    ExportDefaultDeclaration(e) {
      e.declaration && e.declaration.id && i.add(e.declaration.id.name);
    },
    CallExpression(e) {
      const s = C(e);
      s?.tag && t.web.registrations.push(s);
      const n = P(e);
      n && N(n.name, t.web[n.type]);
      N(H(e), t.web.subscriptions);
    },
    ClassDeclaration(e) {
      const n = {
        name: e.id.name,
        extends: e.superClass ? e.superClass.name : null,
        methods: [],
        properties: [],
        calls: [],
        dbReads: [],
        dbWrites: [],
        file: s,
        line: e.loc.start.line
      };
      for (const s of e.body.body) if ("MethodDefinition" === s.type && "constructor" !== s.key.name) n.methods.push(s.key.name),
      j(s.value.body, n.calls, n.dbReads, n.dbWrites); else if ("PropertyDefinition" === s.type && "init$" === s.key.name && s.value && "ObjectExpression" === s.value.type) for (const e of s.value.properties) e.key && e.key.name && n.properties.push(e.key.name);
      t.classes.push(n);
    },
    FunctionDeclaration(e) {
      if (e.id) {
        const n = e.params.map(e => "Identifier" === e.type ? e.name : "AssignmentPattern" === e.type && "Identifier" === e.left.type ? e.left.name + "=" : "RestElement" === e.type && "Identifier" === e.argument.type ? "..." + e.argument.name : "ObjectPattern" === e.type ? "options" : "?"), r = function(e, s) {
          for (let t = 1; t <= 3; t++) {
            const n = e.get(s - t);
            if (n) return n;
          }
          return null;
        }(o, e.loc.start.line), i = function(e, s) {
          if (!s || 0 === s.params.length) return e;
          const t = new Map;
          for (const e of s.params) t.set(e.name, e.type);
          return e.map(e => {
            const s = e.startsWith("..."), n = e.endsWith("=");
            let r = e;
            s && (r = r.slice(3)), n && (r = r.slice(0, -1));
            let o = t.get(r);
            return o ? (o.startsWith("...") && (o = o.slice(3)), `${s ? "..." : ""}${r}:${o}${n ? "=" : ""}`) : e;
          });
        }(n, r), a = {
          name: e.id.name,
          exported: !1,
          params: i,
          async: e.async || !1,
          returns: r?.returns || null,
          calls: [],
          dbReads: [],
          dbWrites: [],
          file: s,
          line: e.loc.start.line
        };
        j(e.body, a.calls, a.dbReads, a.dbWrites), t.functions.push(a);
      }
    }
  });
  for (const e of t.functions) e.exported = i.has(e.name);
  return t.exports = [ ...i ], t;
}

const b = new Set([ "query", "execute", "raw", "exec", "queryFile", "none", "one", "many", "any", "oneOrNone", "manyOrNone", "result" ]);

function j(e, s, t, n) {
  e && c.simple(e, {
    CallExpression(e) {
      const r = e.callee;
      if ("MemberExpression" === r.type) {
        const e = r.object, t = r.property;
        if ("Identifier" === t.type) if ("Identifier" === e.type) {
          const n = `${e.name}.${t.name}`;
          s.includes(n) || s.push(n);
        } else if ("MemberExpression" === e.type && "Identifier" === e.property.type) {
          const n = `${e.property.name}.${t.name}`;
          s.includes(n) || s.push(n);
        } else if ("ThisExpression" === e.type) {
          const e = t.name;
          s.includes(e) || s.push(e);
        }
      } else if ("Identifier" === r.type) {
        const e = r.name;
        s.includes(e) || s.push(e);
      }
      if (t && n) {
        const s = function(e) {
          const s = e.callee;
          return "MemberExpression" === s.type && "Identifier" === s.property.type ? s.property.name : null;
        }(e);
        if (s && b.has(s) && e.arguments.length > 0) {
          const s = function(e) {
            return e ? "Literal" === e.type && "string" == typeof e.value ? e.value : "TemplateLiteral" === e.type ? S(e) : null : null;
          }(e.arguments[0]);
          if (s && g(s)) {
            const e = y(s);
            e.reads.forEach(e => {
              t.includes(e) || t.push(e);
            }), e.writes.forEach(e => {
              n.includes(e) || n.push(e);
            });
          }
        }
      }
    },
    TaggedTemplateExpression(e) {
      if (!t || !n) return;
      const s = function(e) {
        return "Identifier" === e.type ? e.name : "MemberExpression" === e.type && "Identifier" === e.property.type ? e.property.name : null;
      }(e.tag);
      if (s && /sql/i.test(s)) {
        const s = S(e.quasi);
        if (s) {
          const e = y(s);
          e.reads.forEach(e => {
            t.includes(e) || t.push(e);
          }), e.writes.forEach(e => {
            n.includes(e) || n.push(e);
          });
        }
      }
    },
    TemplateLiteral(e) {
      if (!t || !n) return;
      const s = S(e);
      if (s && g(s)) {
        const e = y(s);
        e.reads.forEach(e => {
          t.includes(e) || t.push(e);
        }), e.writes.forEach(e => {
          n.includes(e) || n.push(e);
        });
      }
    },
    Literal(e) {
      if (t && n && "string" == typeof e.value && g(e.value)) {
        const s = y(e.value);
        s.reads.forEach(e => {
          t.includes(e) || t.push(e);
        }), s.writes.forEach(e => {
          n.includes(e) || n.push(e);
        });
      }
    }
  });
}

function S(e) {
  if (!e || !e.quasis) return "";
  let s = "";
  for (let t = 0; t < e.quasis.length; t++) s += e.quasis[t].value.cooked || e.quasis[t].value.raw || "",
  t < e.expressions?.length && (s += "$" + (t + 1));
  return s;
}

function A(e) {
  return "Literal" === e?.type && "string" == typeof e.value ? e.value : "TemplateLiteral" === e?.type && 0 === e.expressions?.length ? S(e) : null;
}

function M(e) {
  return "Identifier" === e?.type ? e.name : "Literal" === e?.type && "string" == typeof e.value ? e.value : null;
}

function C(e) {
  const s = e?.callee;
  if ("MemberExpression" !== s?.type) return null;
  const t = M(s.property), n = s.object;
  if ("reg" === t) return {
    tag: A(e.arguments?.[0]),
    className: "Identifier" === n?.type ? n.name : null
  };
  if ("define" === t && "Identifier" === n?.type && "customElements" === n.name) return {
    tag: A(e.arguments?.[0]),
    className: "Identifier" === e.arguments?.[1]?.type ? e.arguments[1].name : null
  };
  return null;
}

function P(e) {
  const s = e?.callee;
  if ("MemberExpression" !== s?.type) return null;
  const t = M(s.property);
  if ("addEventListener" === t) return {
    type: "eventListeners",
    name: A(e.arguments?.[0])
  };
  if ("dispatchEvent" === t) {
    const s = e.arguments?.[0], t = "NewExpression" === s?.type && ("Identifier" === s.callee?.type && ("CustomEvent" === s.callee.name || "Event" === s.callee.name)) ? A(s.arguments?.[0]) : null;
    return t ? {
      type: "dispatches",
      name: t
    } : null;
  }
  return null;
}

function H(e) {
  const s = e?.callee;
  if ("MemberExpression" !== s?.type) return null;
  const t = M(s.property);
  return "sub" === t || "pub" === t || "multiPub" === t ? A(e.arguments?.[0]) : null;
}

function N(e, s) {
  e && Array.isArray(s) && !s.includes(e) && s.push(e);
}

export function discoverSubProjects(a) {
  const c = i(a), l = [], p = [ "packages", "apps", "services", "modules", "libs", "plugins" ];
  for (const i of p) {
    const a = r(c, i);
    if (n(a)) try {
      for (const i of s(a)) {
        const s = r(a, i), p = r(s, "package.json");
        if (t(s).isDirectory() && n(p)) try {
          const t = JSON.parse(e(p, "utf-8"));
          l.push({
            name: t.name || i,
            path: o(c, s),
            absolutePath: s
          });
        } catch {
          l.push({
            name: i,
            path: o(c, s),
            absolutePath: s
          });
        }
      }
    } catch {}
  }
  return l;
}

export async function parseProject(s, t = {}) {
  const n = {
    files: [],
    classes: [],
    functions: [],
    imports: [],
    exports: [],
    tables: [],
    fileImports: {},
    web: []
  }, a = i(s), c = findJSFiles(s), l = {};
  for (const s of c) try {
    const t = e(s, "utf-8"), r = o(a, s), i = await v(t, r);
    n.files.push(r), n.classes.push(...i.classes), n.functions.push(...i.functions),
    n.imports.push(...i.imports), n.exports.push(...i.exports), i.tables?.length && n.tables.push(...i.tables);
    if (i.importSources?.length) n.fileImports[r] = i.importSources;
    i.web && (l[r] = i.web);
  } catch (e) {}
  if (t.recursive) {
    const e = discoverSubProjects(s);
    n.subProjects = [];
    for (const s of e) try {
      const e = await parseProject(s.absolutePath);
      for (const t of e.files) n.files.push(r(s.path, t));
      for (const t of e.classes) t.file = r(s.path, t.file), n.classes.push(t);
      for (const t of e.functions) t.file = r(s.path, t.file), n.functions.push(t);
      n.imports.push(...e.imports), n.exports.push(...e.exports), e.tables?.length && n.tables.push(...e.tables),
      e.web?.length && n.web.push(...e.web.map(e => ({
        ...e,
        file: e.file ? r(s.path, e.file) : e.file,
        template: e.template ? r(s.path, e.template) : e.template,
        style: e.style ? r(s.path, e.style) : e.style
      }))),
      n.subProjects.push({
        name: s.name,
        path: s.path,
        files: e.files.length
      });
    } catch {}
  }
  return n.web.push(...buildWebComponents(n, l, a)), n.imports = [ ...new Set(n.imports) ], n.exports = [ ...new Set(n.exports) ],
  n;
}

function buildWebComponents(e, s, t) {
  const n = [];
  for (const r of e.classes || []) {
    const o = s[r.file];
    if (!o) continue;
    const i = e.fileImports?.[r.file] || [], a = i.find(e => e.s?.endsWith(".tpl.js"))?.s || null, c = i.find(e => e.s?.endsWith(".css.js"))?.s || null, l = resolveImportFile(t, r.file, a), p = resolveImportFile(t, r.file, c), u = o.registrations.find(e => e.className === r.name) || (1 === o.registrations.length ? o.registrations[0] : null);
    if (!l && !p && !u?.tag && "Symbiote" !== r.extends) continue;
    const f = l ? readTemplateMetadata(t, l, u?.tag) : {}, d = p ? readStyleMetadata(t, p) : {};
    n.push({
      className: r.name,
      tag: u?.tag || null,
      file: r.file,
      template: l,
      style: p,
      children: f.children || [],
      refs: f.refs || [],
      bindings: f.bindings || [],
      templateEvents: f.events || [],
      itemTags: f.itemTags || [],
      eventListeners: o.eventListeners || [],
      dispatches: o.dispatches || [],
      subscriptions: o.subscriptions || [],
      cssTokens: d.tokens || []
    });
  }
  return n;
}

function resolveImportFile(e, s, t) {
  if (!t || !t.startsWith(".")) return null;
  const a = i(r(e, q(s)), t);
  return n(a) ? o(e, a).replaceAll("\\", "/") : null;
}

function readTemplateMetadata(s, t, n) {
  try {
    const o = e(r(s, t), "utf-8"), i = extractBindings(o);
    return {
      children: U([ ...o.matchAll(/<([a-z][\w.-]*-[\w.-]*)\b/g) ].map(e => e[1]).filter(e => e !== n)),
      refs: U([ ...o.matchAll(/\bref=["']([^"']+)["']/g) ].map(e => e[1])),
      bindings: i.bindings,
      events: i.events,
      itemTags: U([ ...o.matchAll(/["']item-tag["']\s*:\s*["']([^"']+)["']/g) ].map(e => e[1]))
    };
  } catch {
    return {};
  }
}

function extractBindings(e) {
  const s = [], t = [];
  for (const n of e.matchAll(/\$\{\{([\s\S]*?)\}\}/g)) {
    const e = n[1] || "";
    for (const n of e.matchAll(/["']?([@:\w.-]+)["']?\s*:\s*["']([^"']+)["']/g)) s.push(`${n[1]}:${n[2]}`),
    n[1].startsWith("on") && t.push(n[1].slice(2).toLowerCase());
  }
  return {
    bindings: U(s),
    events: U(t)
  };
}

function readStyleMetadata(s, t) {
  try {
    const n = e(r(s, t), "utf-8");
    return {
      tokens: U([ ...n.matchAll(/--[a-zA-Z0-9_-]+/g) ].map(e => e[0]))
    };
  } catch {
    return {};
  }
}

function U(e) {
  return [ ...new Set((e || []).map(e => String(e || "").trim()).filter(Boolean)) ];
}

async function v(e, s) {
  return s.endsWith(".sql") ? h(e, s) : s.endsWith(".py") ? d(e, s) : s.endsWith(".go") ? m(e, s) : s.endsWith(".ts") || s.endsWith(".tsx") ? f(e, s) : parseFile(e, s);
}

function E(e) {
  return !e.endsWith(".css.js") && !e.endsWith(".tpl.js") && x.some(s => e.endsWith(s));
}

export function findJSFiles(e, n = e) {
  e === n && u(n);
  const i = [];
  try {
    for (const a of s(e)) {
      const s = r(e, a), c = t(s), u = o(n, e);
      c.isDirectory() ? l(a, u) || i.push(...findJSFiles(s, n)) : E(a) && (p(a, u) || i.push(s));
    }
  } catch (s) {
    console.warn(`Cannot read directory ${e}:`, s.message);
  }
  return i;
}

export function findAllProjectFiles(e, n = e) {
  e === n && u(n);
  const a = [], c = i(n);
  try {
    for (const i of s(e)) {
      const s = r(e, i), u = t(s), f = o(c, e);
      u.isDirectory() ? l(i, f) || a.push(...findAllProjectFiles(s, n)) : p(i, f) || a.push(o(c, s));
    }
  } catch (s) {
    console.warn(`Cannot read directory ${e}:`, s.message);
  }
  return a;
}
