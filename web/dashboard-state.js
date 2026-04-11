export const state = {
  projects: [],
  events: []
};

export const events = new EventTarget();
export function emit(name, detail = {}) {
  events.dispatchEvent(new CustomEvent(name, { detail }));
}
