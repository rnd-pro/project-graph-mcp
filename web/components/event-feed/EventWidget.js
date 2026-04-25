import Symbiote from "@symbiotejs/symbiote";

export class EventWidget extends Symbiote {
  init$ = {
    '@eventData': null,
    isCall: true,
    tool: '',
    argsJSON: '',
    timeStr: '',
    duration: '',
    success: true,
    widgetHTML: '',
  };

  renderCallback() {
    this.sub('@eventData', (evStr) => {
      if (!evStr) return;
      let ev;
      try {
        ev = JSON.parse(evStr);
      } catch {
        return;
      }

      this.$.isCall = ev.type === 'tool_call';
      this.$.tool = ev.tool;
      this.$.timeStr = this._formatTime(ev.ts);
      
      if (this.$.isCall) {
        this.$.argsJSON = JSON.stringify(ev.args || {});
      } else {
        this.$.duration = `${ev.duration_ms}ms`;
        this.$.success = ev.success !== false;
      }

      this._renderWidget(ev);
    });
  }

  _renderWidget(ev) {
    if (ev.type === 'tool_call') {
      this.$.widgetHTML = ''; 
      return;
    }

    const { tool, output, success } = ev;
    if (!success || !output) {
      this.$.widgetHTML = `<div class="error-msg">${this._esc(output || 'Error')}</div>`;
      return;
    }

    let data;
    try {
      data = JSON.parse(output);
    } catch {
      data = output;
    }

    if (tool === 'default_api:view_file' || tool === 'default_api:replace_file_content' || tool === 'default_api:multi_replace_file_content' || tool === 'default_api:write_to_file') {
       this.$.widgetHTML = `<pg-code-widget source='${this._esc(output)}'></pg-code-widget>`;
    } else if (tool === 'default_api:mcp_project-graph_navigate' || tool === 'default_api:mcp_project-graph_get_skeleton') {
       this.$.widgetHTML = `<pg-mini-graph data='${this._esc(JSON.stringify(data))}'></pg-mini-graph>`;
    } else if (tool === 'default_api:list_dir' || tool === 'default_api:grep_search') {
       this.$.widgetHTML = `<pg-list-widget data='${this._esc(output)}'></pg-list-widget>`;
    } else {
       this.$.widgetHTML = `<pre class="raw-output">${this._esc(output).substring(0, 500)}${output.length > 500 ? '...' : ''}</pre>`;
    }
  }

  _esc(s) {
    if (typeof s !== 'string') return '';
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/'/g, "&#39;").replace(/"/g, "&quot;");
  }

  _formatTime(ts) {
    return ts ? new Date(ts).toLocaleTimeString('en', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
  }
}

EventWidget.template = `
<div class="pg-mon-event" \${{ 'data-is-call': 'isCall' }}>
  <div class="event-header">
    <span class="pg-mon-arrow" \${{ textContent: 'isCall ? "→" : "←"' }}></span>
    <span class="pg-mon-tool" \${{ textContent: 'tool' }}></span>
    <span class="pg-mon-time" \${{ textContent: 'timeStr' }}></span>
    <span class="pg-mon-duration" \${{ textContent: 'duration' }}></span>
  </div>
  <div class="event-body" \${{ hidden: '!isCall' }}>
    <span class="pg-mon-args" \${{ textContent: 'argsJSON' }}></span>
  </div>
  <div class="event-body result-body" \${{ hidden: 'isCall' }}>
    <div bind="innerHTML: widgetHTML"></div>
  </div>
</div>
`;

EventWidget.reg('pg-event-widget');
