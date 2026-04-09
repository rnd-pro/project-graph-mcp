export const AGENT_INSTRUCTIONS = `
# 🤖 Project Guidelines for AI Agents

## 1. Architecture Standards (Symbiote.js)
- **Component Structure**: Always use Triple-File Partitioning for components:
  - \`MyComponent.js\`: Class logic (extends Symbiote)
  - \`MyComponent.tpl.js\`: HTML template (export template)
  - \`MyComponent.css.js\`: CSS styles (export rootStyles/shadowStyles)
- **State Management**: Use \`this.init$\` for local state and \`this.sub()\` for reactivity.
- **Directives**: Use \`itemize\` for lists, \`js-d-kit\` for static generation.

## 2. General Coding Rules
- **ESM Only**: Use \`import\` / \`export\`. No \`require\`.
- **No Dependencies**: Avoid adding new npm packages unless critical.
- **Comments**: Write clear JSDoc for all public methods.
- **Async/Await**: Prefer async/await over promises.

## 3. MCP Tools Usage
- **Graph**: Use \`get_skeleton\` first to map the codebase.
- **Deep Dive**: Use \`expand\` to read class details.
- **Tests**: Use \`get_pending_tests\` to see what needs verification.
- **Guidelines**: Use \`get_agent_instructions\` to refresh these rules.

## 4. Custom Rules System
Configurable code analysis with auto-detection.

### Available Tools
- \`get_custom_rules\`: List all rulesets and their rules
- \`set_custom_rule\`: Add or update a rule in a ruleset
- \`check_custom_rules\`: Run analysis (auto-detects applicable rulesets)

### Auto-Detection
Rulesets are applied automatically based on:
1. \`package.json\` dependencies
2. Import patterns in source code
3. Code patterns (e.g., \`extends Symbiote\`)

### Creating New Rules
Use \`set_custom_rule\` to add framework-specific rules:
\`\`\`json
{
  "ruleSet": "my-framework-2x",
  "rule": {
    "id": "my-rule-id",
    "name": "Rule Name",
    "description": "What this rule checks",
    "pattern": "badPattern",
    "patternType": "string",
    "replacement": "Use goodPattern instead",
    "severity": "warning",
    "filePattern": "*.js",
    "docs": "https://docs.example.com/rule"
  }
}
\`\`\`

### Severity Levels
- \`error\`: Critical issues that must be fixed
- \`warning\`: Important but not blocking
- \`info\`: Suggestions and best practices
`;

export function getInstructions() {
  return AGENT_INSTRUCTIONS;
}
