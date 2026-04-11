import Symbiote from '@symbiotejs/symbiote';
import { state, events } from '../../dashboard-state.js';
import styles from './ActionBoard.css.js';
import template from './ActionBoard.tpl.js';
import '../EventItem/EventItem.js';

export class ActionBoard extends Symbiote {
  init$ = {
    eventsItems: [],
  };

  initCallback() {
    console.log('[ActionBoard] initCallback, existing events:', state.events.length);
    events.addEventListener('global-tool-event', (e) => {
      const items = [...state.events].reverse();
      console.log('[ActionBoard] global-tool-event received, total:', items.length, 'latest:', e.detail?.type, e.detail?.tool);
      this.$.eventsItems = items;
    });
    this.$.eventsItems = [...state.events].reverse();
  }
}

ActionBoard.template = template;
ActionBoard.rootStyles = styles;
ActionBoard.reg('pg-action-board');
