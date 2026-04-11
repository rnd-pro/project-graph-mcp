/*
--- file-tree.js ---
class FileTree extends e
  .initCallback()
  ._toggleDir(dir)
  ._saveExpandedState()
  ._updateDirDOM(dir)
  ._collapseAll()
  ._highlightFile(e)
  ._renderTree(e)
  ._getFileIcon(e)
  ._applyFilter()
*/
import e from "@symbiotejs/symbiote";

import { api as t, state as n, events as s, emit as i } from "../app.js";

export class FileTree extends e {
    init$={
        treeHTML: '<div class="pg-placeholder">Loading files...</div>',
        filterText: "",
        onFilterInput: e => {
            this.$.filterText = e.target.value.toLowerCase(), this._applyFilter();
        },
        onCollapseAll: () => {
            this._collapseAll();
        }
    };
    initCallback() {
        this._expandedDirs = new Set;
        try {
            const saved = localStorage.getItem("pg-tree-expanded");
            if (saved) {
                const parsed = JSON.parse(saved);
                Array.isArray(parsed) && (this._expandedDirs = new Set(parsed));
            }
        } catch (e) {}
        s.addEventListener("skeleton-loaded", e => {
            this._renderTree(e.detail), n.activeFile && requestAnimationFrame(() => this._highlightFile(n.activeFile));
        }), n.skeleton && this._renderTree(n.skeleton), s.addEventListener("file-selected", e => {
            e.detail.fromRoute && requestAnimationFrame(() => this._highlightFile(e.detail.path));
        }), this.addEventListener("click", e => {
            const fileEl = e.target.closest(".pg-tree-file");
            if (fileEl) return this.querySelectorAll(".pg-tree-file.active").forEach(el => el.classList.remove("active")), 
            fileEl.classList.add("active"), n.activeFile = fileEl.dataset.file, void i("file-selected", {
                path: fileEl.dataset.file
            });
            const dirEl = e.target.closest(".pg-tree-dir");
            if (dirEl) {
                const dir = dirEl.dataset.dir;
                null != dir && this._toggleDir(dir);
            }
        });
    }
    _toggleDir(dir) {
        this._expandedDirs.has(dir) ? this._expandedDirs.delete(dir) : this._expandedDirs.add(dir), 
        this._saveExpandedState(), this._updateDirDOM(dir);
    }
    _saveExpandedState() {
        localStorage.setItem("pg-tree-expanded", JSON.stringify(Array.from(this._expandedDirs)));
    }
    _updateDirDOM(dir) {
        const dirEl = this.querySelector(`.pg-tree-dir[data-dir="${CSS.escape(dir)}"]`), childrenEl = this.querySelector(`.pg-tree-children[data-dir="${CSS.escape(dir)}"]`);
        if (dirEl && childrenEl) {
            const isExpanded = this._expandedDirs.has(dir), icon = dirEl.querySelector(".pg-chevron");
            icon && (icon.textContent = isExpanded ? "expand_more" : "chevron_right"), isExpanded ? childrenEl.removeAttribute("hidden") : childrenEl.setAttribute("hidden", "");
        }
    }
    _collapseAll() {
        this._expandedDirs.clear(), this._saveExpandedState(), this.querySelectorAll(".pg-tree-dir").forEach(dirEl => {
            this._updateDirDOM(dirEl.dataset.dir);
        });
    }
    _highlightFile(e) {
        const fileEl = this.querySelector(`.pg-tree-file[data-file="${CSS.escape(e)}"]`);
        if (fileEl) {
            this.querySelectorAll(".pg-tree-file.active").forEach(el => el.classList.remove("active")), 
            fileEl.classList.add("active");
            // Expand all ancestor dirs
            const parts = e.split("/");
            parts.pop(); // remove filename
            let changed = !1;
            for (let i = 1; i <= parts.length; i++) {
                const dir = parts.slice(0, i).join("/");
                this._expandedDirs.has(dir) || (this._expandedDirs.add(dir), this._updateDirDOM(dir), changed = !0);
            }
            changed && this._saveExpandedState();
            fileEl.scrollIntoView({ block: "center", behavior: "smooth" });
        }
    }
    _renderTree(e) {
        if (!e) return void (this.$.treeHTML = '<div class="pg-placeholder">No files found</div>');
        const t = new Map, n = e.n || {};
        for (const val of Object.values(n)) if (val.f) {
            const item = t.get(val.f) || { exports: 0, classes: 0 };
            item.classes++, t.set(val.f, item);
        }
        const s = e.X || {};
        for (const [key, val] of Object.entries(s)) {
            const item = t.get(key) || { exports: 0, classes: 0 };
            item.exports = val.length, t.set(key, item);
        }
        const i = e.f || {};
        for (const [key, val] of Object.entries(i)) for (const s of val) {
            const p = "./" === key ? s : `${key}${s}`;
            t.has(p) || t.set(p, { exports: 0, classes: 0 });
        }
        const o = e.a || {};
        for (const [key, val] of Object.entries(o)) for (const s of val) {
            const p = "./" === key ? s : `${key}${s}`;
            t.has(p) || t.set(p, { exports: 0, classes: 0, nonSource: !0 });
        }
        if (0 === t.size) return void (this.$.treeHTML = '<div class="pg-placeholder">No files found</div>');
        // Build nested tree structure
        const root = { children: {}, files: [] };
        for (const [filePath, meta] of t) {
            const parts = filePath.split("/");
            const fileName = parts.pop();
            let node = root;
            for (const part of parts) {
                node.children[part] || (node.children[part] = { children: {}, files: [] });
                node = node.children[part];
            }
            node.files.push({ f: filePath, name: fileName, ...meta });
        }
        // Render recursively
        const renderNode = (node, dirPath, depth) => {
            const l = [];
            // Sort: dirs first, then files
            const dirs = Object.keys(node.children).sort();
            const files = node.files.sort((a, b) => a.name.localeCompare(b.name));
            const pad = depth * 16;
            for (const dirName of dirs) {
                const childPath = dirPath ? `${dirPath}/${dirName}` : dirName;
                const isExpanded = this._expandedDirs && this._expandedDirs.has(childPath);
                const chevron = isExpanded ? "expand_more" : "chevron_right";
                const hiddenAttr = isExpanded ? "" : " hidden";
                l.push(`<div class="pg-tree-dir" data-dir="${childPath}" style="padding-left:${pad + 6}px"><span class="material-symbols-outlined pg-chevron" style="font-size:16px">${chevron}</span> <span class="material-symbols-outlined" style="font-size:16px">folder</span> ${dirName}</div>`);
                l.push(`<div class="pg-tree-children" data-dir="${childPath}"${hiddenAttr}>`);
                l.push(renderNode(node.children[dirName], childPath, depth + 1));
                l.push("</div>");
            }
            for (const file of files) {
                const icon = FileTree._getFileIcon(file.name), badges = [];
                file.exports > 0 && badges.push(`${file.exports}f`);
                file.classes > 0 && badges.push(`${file.classes}c`);
                const badgeHtml = badges.length > 0 ? `<span class="pg-badge">${badges.join(" ")}</span>` : "";
                const nonSourceClass = file.nonSource ? " pg-non-source" : "";
                l.push(`<div class="pg-tree-file${nonSourceClass}" data-file="${file.f}" style="padding-left:${pad + 24}px"><span class="material-symbols-outlined" style="font-size:14px">${icon}</span> ${file.name}${badgeHtml}</div>`);
            }
            return l.join("");
        };
        this.$.treeHTML = renderNode(root, "", 0);
    }
    static _getFileIcon(e) {
        return e.endsWith(".html") ? "html" : e.endsWith(".css") || e.endsWith(".css.js") ? "css" : e.endsWith(".tpl.js") ? "web" : e.endsWith(".json") ? "data_object" : e.endsWith(".md") ? "description" : e.endsWith(".svg") || e.endsWith(".png") || e.endsWith(".jpg") ? "image" : e.endsWith(".woff2") || e.endsWith(".ttf") ? "font_download" : "insert_drive_file";
    }
    _applyFilter() {
        const e = this.$.filterText;
        let changed = !1;
        this.querySelectorAll(".pg-tree-file").forEach(t => {
            const match = !e || t.dataset.file.toLowerCase().includes(e);
            if (t.hidden = !match, e && match) {
                // Expand all ancestor dirs
                const parts = t.dataset.file.split("/");
                parts.pop();
                for (let i = 1; i <= parts.length; i++) {
                    const dir = parts.slice(0, i).join("/");
                    this._expandedDirs.has(dir) || (this._expandedDirs.add(dir), changed = !0, this._updateDirDOM(dir));
                }
            }
        }), changed && this._saveExpandedState(), e ? this.querySelectorAll(".pg-tree-dir").forEach(dirEl => {
            const dir = dirEl.dataset.dir;
            const childrenEl = this.querySelector(`.pg-tree-children[data-dir="${CSS.escape(dir)}"]`);
            if (!childrenEl) return;
            let hasVisible = !1;
            childrenEl.querySelectorAll(".pg-tree-file").forEach(f => { f.hidden || (hasVisible = !0); });
            childrenEl.querySelectorAll(".pg-tree-children").forEach(c => { c.querySelector(".pg-tree-file:not([hidden])") && (hasVisible = !0); });
            dirEl.hidden = !hasVisible;
        }) : this.querySelectorAll(".pg-tree-dir").forEach(dirEl => {
            dirEl.hidden = !1;
        });
    }
}

FileTree.template = '\n  <div class="pg-panel-toolbar">\n    <input type="search" placeholder="Filter files..." bind="oninput: onFilterInput">\n    <button class="pg-collapse-all" bind="onclick: onCollapseAll" title="Collapse All Folders">\n      <span class="material-symbols-outlined" style="font-size:14px">unfold_less</span>\n    </button>\n  </div>\n  <div class="pg-tree-content" bind="innerHTML: treeHTML"></div>\n', 
FileTree.rootStyles = "\n  pg-file-tree {\n    display: flex;\n    flex-direction: column;\n    height: 100%;\n    overflow: hidden;\n    font-size: 12px;\n    font-family: var(--sn-font, Georgia, serif);\n  }\n  pg-file-tree .pg-panel-toolbar {\n    padding: 6px 8px;\n    border-bottom: 1px solid var(--sn-node-border, hsl(35, 18%, 80%));\n    display: flex;\n    gap: 6px;\n  }\n  pg-file-tree .pg-panel-toolbar input {\n    flex: 1;\n    background: var(--sn-bg, hsl(37, 30%, 91%));\n    border: 1px solid var(--sn-node-border, hsl(35, 18%, 80%));\n    color: var(--sn-text, hsl(30, 15%, 18%));\n    padding: 4px 8px;\n    border-radius: 4px;\n    font-size: 11px;\n    font-family: inherit;\n    outline: none;\n    min-width: 0;\n  }\n  pg-file-tree .pg-panel-toolbar input:focus {\n    border-color: var(--sn-node-selected, hsl(210, 55%, 42%));\n  }\n  pg-file-tree .pg-collapse-all {\n    background: var(--sn-bg, hsl(37, 30%, 91%));\n    border: 1px solid var(--sn-node-border, hsl(35, 18%, 80%));\n    color: var(--sn-text, hsl(30, 15%, 18%));\n    border-radius: 4px;\n    cursor: pointer;\n    display: flex;\n    align-items: center;\n    justify-content: center;\n    padding: 0 6px;\n    transition: all 100ms ease;\n  }\n  pg-file-tree .pg-collapse-all:hover {\n    background: var(--sn-node-hover, hsl(36, 22%, 88%));\n  }\n  pg-file-tree .pg-tree-content {\n    flex: 1;\n    overflow-y: auto;\n    padding: 4px;\n  }\n  pg-file-tree .pg-tree-dir {\n    display: flex;\n    align-items: center;\n    gap: 4px;\n    padding: 3px 6px;\n    color: var(--sn-text-dim, hsl(30, 10%, 45%));\n    font-weight: 600;\n    font-size: 11px;\n    cursor: pointer;\n    user-select: none;\n  }\n  pg-file-tree .pg-tree-dir:hover {\n    background: var(--sn-node-hover, hsl(36, 22%, 88%));\n    border-radius: 4px;\n  }\n  pg-file-tree .pg-tree-dir .pg-chevron {\n    transition: transform 150ms ease;\n  }\n  pg-file-tree .pg-tree-children[hidden] {\n    display: none;\n  }\n  pg-file-tree .pg-tree-file {\n    display: flex;\n    align-items: center;\n    gap: 4px;\n    padding: 3px 6px 3px 24px;\n    cursor: pointer;\n    border-radius: 4px;\n    color: var(--sn-text-dim, hsl(30, 10%, 45%));\n    transition: all 100ms ease;\n  }\n  pg-file-tree .pg-tree-file:hover {\n    background: var(--sn-node-hover, hsl(36, 22%, 88%));\n    color: var(--sn-text, hsl(30, 15%, 18%));\n  }\n  pg-file-tree .pg-tree-file.active {\n    background: hsla(210, 45%, 45%, 0.12);\n    color: var(--sn-cat-server, hsl(210, 45%, 45%));\n  }\n  pg-file-tree .pg-tree-file[hidden] {\n    display: none;\n  }\n  pg-file-tree .pg-tree-file.pg-non-source {\n    opacity: 0.6;\n  }\n  pg-file-tree .pg-badge {\n    margin-left: auto;\n    font-size: 10px;\n    padding: 0 5px;\n    border-radius: 8px;\n    background: var(--sn-node-hover, hsl(36, 22%, 88%));\n    color: var(--sn-text-dim, hsl(30, 10%, 45%));\n    border: 1px solid var(--sn-node-border, hsl(35, 18%, 80%));\n  }\n", 
FileTree.reg("pg-file-tree");