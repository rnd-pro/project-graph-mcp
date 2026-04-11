import Symbiote from '@symbiotejs/symbiote';
import styles from './ProjectItem.css.js';
import template from './ProjectItem.tpl.js';

export class ProjectItem extends Symbiote {
  init$ = {
    prefix: '',
    projectName: '',
    projectPath: '',
  };

  renderCallback() {
    this.sub('prefix', (val) => {
      this.ref.link.href = val ? `${val}/` : '#';
    });
  }
}

ProjectItem.template = template;
ProjectItem.rootStyles = styles;
ProjectItem.reg('pg-project-item');
