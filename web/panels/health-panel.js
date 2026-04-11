import Symbiote from '@symbiotejs/symbiote';
import { api, state, events } from '../app.js';

/**
 * <pg-health-panel> — Project health dashboard.
 * Combines skeleton stats with analysis-summary API data.
 */
export class HealthPanel extends Symbiote {
  init$ = {
    contentHTML: '<div class="pg-placeholder">Loading health analysis...</div>',
    loaded: false,
  };

  initCallback() {
    // Try loading immediately or wait for skeleton
    events.addEventListener('skeleton-loaded', () => this._loadHealth());
    setTimeout(() => this._loadHealth(), 500);
  }

  async _loadHealth() {
    if (this.$.loaded) return;
    this.$.contentHTML = '<div class="pg-placeholder pg-pulse">Analyzing project health...</div>';

    try {
      const data = await api('/api/analysis-summary');
      this.$.loaded = true;

      const score = data.healthScore ?? data.score ?? '?';
      const scoreClass = score >= 80 ? 'good' : score >= 50 ? 'warning' : 'critical';
      const grade = data.grade || (score >= 80 ? 'healthy' : score >= 50 ? 'needs work' : 'critical');

      // Get stats from skeleton.s (project stats summary)
      const stats = state.skeleton?.s || {};
      const totalFiles = stats.files || Object.keys(state.skeleton?.X || {}).length || '—';
      const totalFn = stats.functions || 0;
      const totalCls = stats.classes || 0;
      const totalExports = Object.values(state.skeleton?.X || {}).reduce((s, v) => s + v.length, 0);

      this.$.contentHTML = `
        <div class="pg-health-grid">
          <div class="pg-health-card pg-health-score-card">
            <div class="pg-health-score ${scoreClass}">${score}</div>
            <div class="pg-health-score-label">Health Score · ${grade}</div>
          </div>
          <div class="pg-health-card">
            <div class="pg-health-card-title">
              <span class="material-symbols-outlined" style="font-size:16px">code</span>
              Code
            </div>
            ${this._metric('Source files', totalFiles)}
            ${this._metric('Functions', totalFn)}
            ${this._metric('Classes', totalCls)}
            ${this._metric('Exports', totalExports)}
          </div>
          <div class="pg-health-card">
            <div class="pg-health-card-title">
              <span class="material-symbols-outlined" style="font-size:16px">bug_report</span>
              Issues
            </div>
            ${this._metric('Complexity', data.complexity || 0, data.complexity > 200)}
            ${this._metric('JSDoc issues', data.jsdocIssues || 0, data.jsdocIssues > 10)}
            ${this._metric('Undocumented', data.undocumented || 0, data.undocumented > 5)}
          </div>
          <div class="pg-health-card">
            <div class="pg-health-card-title">
              <span class="material-symbols-outlined" style="font-size:16px">speed</span>
              Cache Performance
            </div>
            ${this._metric('Cache hits', data.cache?.hits ?? '—')}
            ${this._metric('Cache misses', data.cache?.misses ?? '—')}
            ${this._metric('Hit rate', data.cache ? Math.round(data.cache.hits / (data.cache.hits + data.cache.misses) * 100) + '%' : '—')}
          </div>
        </div>
        ${data.note ? `<div class="pg-health-note"><span class="material-symbols-outlined" style="font-size:14px">info</span> ${data.note}</div>` : ''}
      `;
    } catch (err) {
      this.$.contentHTML = `<div class="pg-placeholder" style="color:var(--sn-danger-color)">Error: ${err.message}</div>`;
    }
  }

  _metric(label, value, warn = false) {
    const cls = warn ? ' pg-metric-warn' : '';
    return `<div class="pg-metric${cls}"><span>${label}</span><span class="pg-metric-val">${value}</span></div>`;
  }
}

HealthPanel.template = /*html*/`<div bind="innerHTML: contentHTML"></div>`;

HealthPanel.rootStyles = /*css*/`
  pg-health-panel { display:block; height:100%; overflow-y:auto; padding:16px; font-family:var(--sn-font, Georgia, serif); }
  .pg-health-grid { display:grid; grid-template-columns:repeat(auto-fit, minmax(200px,1fr)); gap:12px; align-content:start; }
  .pg-health-card {
    background: var(--sn-node-bg);
    border: 1px solid var(--sn-node-border);
    border-radius: 8px;
    padding: 14px;
  }
  .pg-health-score-card { text-align:center; grid-column:1/-1; padding:20px; }
  .pg-health-score { font-size:56px; font-weight:800; font-family:monospace; }
  .pg-health-score.good { color: var(--sn-success-color, hsl(150, 55%, 38%)); }
  .pg-health-score.warning { color: var(--sn-warning-color, hsl(38, 55%, 42%)); }
  .pg-health-score.critical { color: var(--sn-danger-color, hsl(4, 55%, 48%)); }
  .pg-health-score-label { font-size:11px; text-transform:uppercase; letter-spacing:1px; color:var(--sn-text-dim); margin-top:4px; }
  .pg-health-card-title {
    display: flex; align-items: center; gap: 6px;
    font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:0.5px;
    color:var(--sn-text-dim); margin-bottom:8px;
  }
  .pg-metric { display:flex; justify-content:space-between; padding:5px 0; border-bottom:1px solid var(--sn-node-hover); font-size:12px; color:var(--sn-text); }
  .pg-metric:last-child { border:none; }
  .pg-metric-val { font-weight:600; font-family:monospace; }
  .pg-metric-warn .pg-metric-val { color:var(--sn-warning-color); }
  .pg-health-note {
    display: flex; align-items: center; gap: 6px;
    margin-top: 12px; padding: 10px 12px;
    font-size: 11px; color: var(--sn-text-dim);
    background: var(--sn-node-bg);
    border: 1px solid var(--sn-node-border);
    border-radius: 6px;
  }
  .pg-placeholder { color:var(--sn-text-dim); text-align:center; padding:40px; font-style:italic; font-size:13px; }
  .pg-pulse { animation:pulse 1.5s ease infinite; }
  @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
`;

HealthPanel.reg('pg-health-panel');
