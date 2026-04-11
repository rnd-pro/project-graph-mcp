export default /*css*/ `
pg-settings-panel {
  display: block;
  height: 100%;
  overflow-y: auto;
  padding: 16px;
  font-family: var(--sn-font, 'Inter', -apple-system, sans-serif);
}

.pg-stg-card {
  background: var(--sn-node-bg);
  border: 1px solid var(--sn-node-border);
  border-radius: 8px;
  padding: 14px;
  margin-bottom: 12px;
}

.pg-stg-title {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--sn-text-dim);
  margin-bottom: 8px;
}

.pg-stg-metric {
  display: flex;
  justify-content: space-between;
  padding: 5px 0;
  border-bottom: 1px solid var(--sn-node-hover);
  font-size: 12px;
  color: var(--sn-text);
}

.pg-stg-metric:last-child {
  border-bottom: none;
}

.pg-stg-val {
  font-weight: 600;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
}

.pg-stg-ok {
  color: var(--sn-success-color, #4caf50);
}

.pg-stg-btn {
  background: var(--sn-node-bg);
  border: 1px solid var(--sn-node-border);
  color: var(--sn-text);
  padding: 6px 14px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 12px;
  font-family: inherit;
  transition: border-color 0.15s;
}

.pg-stg-btn:hover {
  border-color: var(--sn-node-selected, #4c8bf5);
}

.pg-stg-placeholder {
  color: var(--sn-text-dim);
  text-align: center;
  padding: 20px;
  font-style: italic;
  font-size: 13px;
}

.pg-stg-pulse {
  animation: pg-stg-pulse 1.5s ease infinite;
}

@keyframes pg-stg-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}
`;
