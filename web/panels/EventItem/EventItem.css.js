export default /*css*/ `
:host {
  display: flex;
  padding: 8px;
  border-bottom: 1px solid var(--sn-border-primary);
  font-size: 13px;
  font-family: var(--sn-font-mono, monospace);
}
.event-time {
  color: var(--sn-fg-muted);
  width: 80px;
  flex-shrink: 0;
}
.event-type {
  width: 90px;
  flex-shrink: 0;
  color: #4ade80;
}
.event-desc {
  flex: 1;
  word-break: break-all;
}
`;
