import Symbiote from '@symbiotejs/symbiote';
import { state, events } from '../../dashboard-state.js';
import styles from './ProjectList.css.js';
import template from './ProjectList.tpl.js';
import '../ProjectItem/ProjectItem.js';

export class ProjectList extends Symbiote {
  init$ = {
    projects: [],
    hasProjects: false,
  };

  initCallback() {
    events.addEventListener('projects-updated', (e) => {
      this.$.projects = e.detail;
      this.$.hasProjects = e.detail.length > 0;
    });
    this.$.projects = state.projects;
    this.$.hasProjects = state.projects.length > 0;
  }

  renderCallback() {
    this.sub('hasProjects', (val) => {
      this.ref.emptyMsg.hidden = val;
    });
  }
}

ProjectList.template = template;
ProjectList.rootStyles = styles;
ProjectList.reg('pg-project-list');
