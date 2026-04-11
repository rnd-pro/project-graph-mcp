import Symbiote from '@symbiotejs/symbiote';
import styles from './EventItem.css.js';
import template from './EventItem.tpl.js';

export class EventItem extends Symbiote {
  init$ = {
    ts: 0,
    type: '',
    tool: '',
  };

  renderCallback() {
    this.sub('ts', (val) => {
      this.ref.time.textContent = val
        ? new Date(val).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
        : '';
    });
  }
}

EventItem.template = template;
EventItem.rootStyles = styles;
EventItem.reg('pg-event-item');
