import { describe as e, it as s, afterEach as t } from "node:test";

import o from "node:assert";

import { mkdtempSync as r, rmSync as c, mkdirSync as p, writeFileSync as u } from "node:fs";

import { tmpdir as f } from "node:os";

import { join as d } from "node:path";

import { parseFile as n, parseProject as i } from "../src/core/parser.js";

import { buildGraph as a, minifyLegend as l, createSkeleton as m } from "../src/core/graph-builder.js";

const h = [];

t(() => {
  for (const e of h.splice(0)) c(e, {
    recursive: !0,
    force: !0
  });
});

e("AST Parser", () => {
  e("parseFile()", () => {
    s("should extract class with methods and properties", async () => {
      const e = await n("\n        import Symbiote from '@symbiotejs/symbiote';\n        \n        export class SymNode extends Symbiote {\n          init$ = {\n            nodeTitle: 'Node',\n            nodeColor: '#fff',\n          };\n          \n          togglePin() {\n            this._pinned = !this._pinned;\n          }\n          \n          getSocketPosition(name) {\n            return { x: 0, y: 0 };\n          }\n        }\n      ", "SymNode.js");
      o.strictEqual(e.classes.length, 1), o.strictEqual(e.classes[0].name, "SymNode"),
      o.strictEqual(e.classes[0].extends, "Symbiote"), o.deepStrictEqual(e.classes[0].properties, [ "nodeTitle", "nodeColor" ]),
      o.deepStrictEqual(e.classes[0].methods, [ "togglePin", "getSocketPosition" ]), o.deepStrictEqual(e.imports, [ "Symbiote" ]);
    }), s("should extract standalone functions", async () => {
      const e = await n("\n        export function calculateLayout(nodes) {\n          return nodes.map(n => ({ ...n, x: 0 }));\n        }\n        \n        function helperFn() {}\n      ", "utils.js");
      o.strictEqual(e.functions.length, 2), o.strictEqual(e.functions[0].name, "calculateLayout"),
      o.strictEqual(e.functions[0].exported, !0), o.strictEqual(e.functions[1].name, "helperFn"),
      o.strictEqual(e.functions[1].exported, !1);
    }), s("should detect method calls to other classes", async () => {
      const e = await n("\n        class Controller {\n          init() {\n            this.node.togglePin();\n            AutoLayout.arrange(this.nodes);\n          }\n        }\n      ", "controller.js");
      o.ok(e.classes[0].calls.includes("node.togglePin")), o.ok(e.classes[0].calls.includes("AutoLayout.arrange"));
    });
  }), e("parseProject()", () => {
    s("should parse all JS files in directory", async () => {
      const e = await i("src");
      o.ok(e.files.length > 0, "Should find JS files"), o.ok(e.functions.length > 0, "Should find exported functions");
    });
  });
}), e("Graph Builder", () => {
  e("minifyLegend()", () => {
    s("should create short aliases for long names", () => {
      const e = l([ "SymNode", "SymNodeGraph", "SymMiniMap", "togglePin", "autoArrange" ]);
      o.strictEqual(e.SymNode, "SN"), o.strictEqual(e.SymNodeGraph, "SNG"), o.strictEqual(e.SymMiniMap, "SMM"),
      o.strictEqual(e.togglePin, "tP"), o.strictEqual(e.autoArrange, "aA");
    }), s("should handle collisions with suffix", () => {
      const e = l([ "SymNode", "SymNew" ]), s = Object.values(e);
      o.strictEqual(new Set(s).size, 2);
    });
  }), e("buildGraph()", () => {
    s("should build nodes with edges from parsed data", () => {
      const e = a({
        files: [ "SymNode.js", "SymNodeGraph.js" ],
        classes: [ {
          name: "SymNode",
          methods: [ "togglePin" ],
          imports: [ "Symbiote" ]
        }, {
          name: "SymNodeGraph",
          methods: [ "addNode" ],
          calls: [ "SymNode.togglePin" ]
        } ]
      });
      o.ok(e.nodes.SN), o.ok(e.nodes.SNG), o.deepStrictEqual(e.edges, [ [ "SNG", "→", "SN.tP" ] ]);
    }), s("should detect orphan nodes (no incoming edges)", () => {
      const e = a({
        files: [ "utils.js" ],
        classes: [],
        functions: [ {
          name: "helperFn",
          exported: !1,
          calls: []
        } ]
      });
      o.ok(e.orphans.includes("helperFn"));
    }), s("should detect duplicate method names", () => {
      const e = a({
        files: [ "a.js", "b.js" ],
        classes: [ {
          name: "A",
          methods: [ "parsePosition" ],
          file: "a.js",
          line: 10
        }, {
          name: "B",
          methods: [ "parsePosition" ],
          file: "b.js",
          line: 20
        } ]
      });
      o.ok(e.duplicates.parsePosition), o.strictEqual(e.duplicates.parsePosition.length, 2);
    });
  });
}), e("Web Component Graph", () => {
  s("should attach template, style, and custom element links to component nodes", async () => {
    const e = r(d(f(), "project-graph-web-"));
    h.push(e), p(d(e, "src"), {
      recursive: !0
    }), u(d(e, "src", "Panel.js"), `import { Symbiote } from '@symbiotejs/symbiote';
import template from './Panel.tpl.js';
import css from './Panel.css.js';
import './ChildCard.js';

export class Panel extends Symbiote {
  init$ = { items: [] };
  renderCallback() {
    this.sub('items', () => {});
    this.addEventListener('panel-open', () => {});
    this.dispatchEvent(new CustomEvent('panel-ready'));
  }
}
Panel.template = template;
Panel.rootStyles = css;
Panel.reg('demo-panel');
`), u(d(e, "src", "Panel.tpl.js"), `import { html } from '@symbiotejs/symbiote';
export default html\`
  <child-card ref="card" \${{ onclick: 'onCardClick', itemize: 'items', 'item-tag': 'child-card' }}></child-card>
\`;
`), u(d(e, "src", "Panel.css.js"), "export default `:host { color: var(--sn-text); background: var(--sn-bg); }`;"),
    u(d(e, "src", "ChildCard.js"), `import { Symbiote } from '@symbiotejs/symbiote';
export class ChildCard extends Symbiote {}
ChildCard.reg('child-card');
`);
    const s = await i(d(e, "src")), t = a(s), n = t.legend.Panel, g = t.legend.ChildCard, c = m(t);
    o.ok(n), o.ok(g), o.deepStrictEqual(s.files.sort(), [ "ChildCard.js", "Panel.js" ]),
    o.strictEqual(s.web.find(e => "Panel" === e.className).template, "Panel.tpl.js"),
    o.deepStrictEqual(t.nodes[n].i, [ "@symbiotejs/symbiote", "./Panel.tpl.js", "./Panel.css.js", "./ChildCard.js" ]),
    o.strictEqual(t.nodes[n].w.tag, "demo-panel"), o.deepStrictEqual(t.nodes[n].w.children, [ "child-card" ]),
    o.ok(t.nodes[n].w.refs.includes("card")), o.ok(t.nodes[n].w.bindings.includes("onclick:onCardClick")),
    o.ok(t.nodes[n].w.events.includes("panel-open")), o.ok(t.nodes[n].w.events.includes("click")),
    o.ok(t.nodes[n].w.dispatches.includes("panel-ready")), o.ok(t.nodes[n].w.subscriptions.includes("items")),
    o.ok(t.nodes[n].w.tokens.includes("--sn-text")), o.ok(t.edges.some(e => e[0] === n && "F→" === e[1] && "Panel.tpl.js" === e[2])),
    o.ok(t.edges.some(e => e[0] === n && "E→" === e[1] && g === e[2])), o.deepStrictEqual(c.W[n].children, [ "child-card" ]);
  });
}), e("Focus Zone", () => {
  s("should prioritize recently modified files", async () => {});
});
