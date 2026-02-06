/**
 * Project Guidelines and Instructions for AI Agents
 */

export const AGENT_INSTRUCTIONS = `
# 🤖 Project Guidelines for AI Agents

## 1. Architecture Standards (Symbiote.js)
- **Component Structure**: Alway use Triple-File Partitioning for components:
  - \`MyComponent.js\`: Class logic (extends Symbiote)
  - \`MyComponent.tpl.js\`: HTML template (export template)
  - \`MyComponent.css.js\`: CSS styles (export rootStyles/shadowStyles)
- **State Management**: Use \`this.init$\` for local state and \`this.sub()\` for reactivity.
- **Directives**: Use \`itemize\` for lists, \`js-d-kit\` for static generation.

## 2. JSDoc & Test Annotations (@test/@expect)
To enable the **Test Checklist** system, you MUST add specific JSDoc annotations to interactive methods.

### Syntax
\`\`\`javascript
/**
 * method description
 * 
 * @test {type}: {description}
 * @expect {type}: {description}
 */
async myMethod() { ... }
\`\`\`

### Supported Types
- **@test**: \`click\`, \`key\`, \`drag\`, \`type\`, \`scroll\`, \`wait\`
- **@expect**: \`attr\`, \`visual\`, \`behavior\`, \`value\`, \`element\`

### Example
\`\`\`javascript
/**
 * Toggle pinned state of the node
 * 
 * @test click: Click the pin icon
 * @test key: Press 'P' key while hovered
 * 
 * @expect attr: 'data-pinned' attribute should toggle
 * @expect visual: Pin icon should change color
 */
togglePin() {
  // ...
}
\`\`\`

## 3. General Coding Rules
- **ESM Only**: Use \`import\` / \`export\`. No \`require\`.
- **No Dependencies**: Avoid adding new npm packages unless critical. Use vendored libs.
- **Comments**: Write clear JSDoc for all public methods.
- **Async/Await**: Prefer async/await over promises.

## 4. MCP Tools Usage
- **Graph**: Use \`get_skeleton\` first to map the codebase.
- **Deep Dive**: Use \`expand\` to read class details.
- **Tests**: Use \`get_pending_tests\` to see what needs verification.
`;

/**
 * Get agent instructions
 * @returns {string}
 */
export function getInstructions() {
  return AGENT_INSTRUCTIONS;
}
