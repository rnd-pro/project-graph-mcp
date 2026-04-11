import Symbiote from '@symbiotejs/symbiote';
import styles from './SettingsPanel.css.js';
import template from './SettingsPanel.tpl.js';

function metric(label, value, cls = '') {
  return `<div class="pg-stg-metric"><span>${label}</span><span class="pg-stg-val ${cls}">${value}</span></div>`;
}

export class SettingsPanel extends Symbiote {
  init$ = {};

  renderCallback() {
    this.ref.refreshBtn.onclick = () => this.fetchInfo();
    this.fetchInfo();
  }

  async fetchInfo() {
    this.ref.backendCard.innerHTML = '<div class="pg-stg-placeholder pg-stg-pulse">Loading…</div>';

    try {
      const [info, instances] = await Promise.all([
        fetch('/api/project-info').then(r => r.json()),
        fetch('/api/instances').then(r => r.json()),
      ]);

      this.ref.backendCard.innerHTML = [
        metric('Status', 'Running', 'pg-stg-ok'),
        metric('Project', info.name || '—'),
        metric('Path', info.path || '—'),
        metric('PID', info.pid || '—'),
        metric('Connected Agents', info.agents ?? '—'),
        metric('Idle Shutdown', '15 min'),
      ].join('');

      const list = this.ref.instanceList;
      list.innerHTML = '';

      if (Array.isArray(instances) && instances.length > 0) {
        for (const inst of instances) {
          const uptime = inst.startedAt
            ? Math.round((Date.now() - inst.startedAt) / 60000)
            : '?';
          const card = document.createElement('div');
          card.className = 'pg-stg-card';
          card.innerHTML = [
            metric('Name', inst.name || 'unknown'),
            metric('Path', inst.project || '—'),
            metric('PID', inst.pid),
            metric('Port', inst.port),
            metric('Uptime', `${uptime} min`),
          ].join('');
          list.appendChild(card);
        }
      } else {
        list.innerHTML = '<div class="pg-stg-placeholder">No active instances</div>';
      }
    } catch (err) {
      console.error('[SettingsPanel] fetch error:', err);
      this.ref.backendCard.innerHTML = `<div class="pg-stg-placeholder" style="color:var(--sn-danger-color)">Error: ${err.message}</div>`;
    }
  }
}

SettingsPanel.template = template;
SettingsPanel.rootStyles = styles;
SettingsPanel.reg('pg-settings-panel');
