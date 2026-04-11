export default /*css*/ `
:host {
  display: block;
}
.card {
  background: var(--sn-bg-secondary);
  border: 1px solid var(--sn-border-primary);
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 12px;
  transition: border-color 0.2s;
}
.card:hover {
  border-color: var(--project-accent, #7878ff);
}
.title {
  font-size: 16px;
  font-weight: 500;
  margin-bottom: 4px;
}
.path {
  font-size: 12px;
  font-family: var(--sn-font-mono, monospace);
  color: var(--sn-fg-muted);
  word-break: break-all;
}
a {
  color: var(--project-accent, #7878ff);
  text-decoration: none;
}
a:hover {
  text-decoration: underline;
}
`;
