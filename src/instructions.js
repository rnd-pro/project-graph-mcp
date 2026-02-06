/**
 * Project Guidelines and Instructions for AI Agents
 */

export const AGENT_INSTRUCTIONS = `
# 🤖 Project Guidelines for AI Agents

## 1. Architecture Standards (Symbiote.js)
- **Component Structure**: Always use Triple-File Partitioning for components:
  - \`MyComponent.js\`: Class logic (extends Symbiote)
  - \`MyComponent.tpl.js\`: HTML template (export template)
  - \`MyComponent.css.js\`: CSS styles (export rootStyles/shadowStyles)
- **State Management**: Use \`this.init$\` for local state and \`this.sub()\` for reactivity.
- **Directives**: Use \`itemize\` for lists, \`js-d-kit\` for static generation.

## 2. Test Annotations (@test/@expect)
Universal verification checklist system. Works for **any** test type.

### Syntax
\`\`\`javascript
/**
 * Method description
 * 
 * @test {type}: {description}
 * @expect {type}: {description}
 */
async myMethod() { ... }
\`\`\`

### @test Types by Category

#### 🌐 Browser / UI
| Type | Description | Example |
|------|-------------|---------|
| \`click\` | Click element | \`@test click: Click submit button\` |
| \`key\` | Keyboard input | \`@test key: Press Enter\` |
| \`drag\` | Drag and drop | \`@test drag: Drag item to list\` |
| \`type\` | Text input | \`@test type: Enter email in field\` |
| \`scroll\` | Scroll action | \`@test scroll: Scroll to bottom\` |
| \`hover\` | Mouse hover | \`@test hover: Hover over menu\` |

#### 🔌 API / Function
| Type | Description | Example |
|------|-------------|---------|
| \`request\` | HTTP request | \`@test request: POST /api/users\` |
| \`call\` | Function call | \`@test call: Call with valid params\` |
| \`invoke\` | Method invoke | \`@test invoke: Trigger event\` |
| \`mock\` | Mock setup | \`@test mock: Mock external service\` |

#### 💻 CLI / Process
| Type | Description | Example |
|------|-------------|---------|
| \`run\` | Run command | \`@test run: Run with --help flag\` |
| \`exec\` | Execute script | \`@test exec: Execute build script\` |
| \`spawn\` | Spawn process | \`@test spawn: Start server\` |
| \`input\` | Stdin input | \`@test input: Enter password\` |

#### 🔗 Integration / System
| Type | Description | Example |
|------|-------------|---------|
| \`setup\` | Test setup | \`@test setup: Create test database\` |
| \`action\` | Main action | \`@test action: Run migration\` |
| \`teardown\` | Cleanup | \`@test teardown: Remove temp files\` |
| \`wait\` | Wait condition | \`@test wait: Wait for DB connection\` |

### @expect Types by Category

#### 🌐 Browser / UI
| Type | Description | Example |
|------|-------------|---------|
| \`attr\` | Attribute check | \`@expect attr: disabled attribute set\` |
| \`visual\` | Visual change | \`@expect visual: Button turns green\` |
| \`element\` | Element exists | \`@expect element: Modal appears\` |
| \`text\` | Text content | \`@expect text: Shows "Success"\` |

#### 🔌 API / Function
| Type | Description | Example |
|------|-------------|---------|
| \`status\` | HTTP status | \`@expect status: 201 Created\` |
| \`body\` | Response body | \`@expect body: Contains user ID\` |
| \`headers\` | Response headers | \`@expect headers: Content-Type JSON\` |
| \`error\` | Error thrown | \`@expect error: Throws ValidationError\` |

#### 💻 CLI / Process
| Type | Description | Example |
|------|-------------|---------|
| \`output\` | Stdout content | \`@expect output: Prints version\` |
| \`exitcode\` | Exit code | \`@expect exitcode: Returns 0\` |
| \`file\` | File created | \`@expect file: Creates config.json\` |
| \`stderr\` | Stderr content | \`@expect stderr: No errors\` |

#### 🔗 Integration / System
| Type | Description | Example |
|------|-------------|---------|
| \`state\` | State change | \`@expect state: User logged in\` |
| \`log\` | Log entry | \`@expect log: Info message logged\` |
| \`event\` | Event fired | \`@expect event: 'updated' emitted\` |
| \`db\` | Database change | \`@expect db: Row inserted\` |

### Full Example
\`\`\`javascript
/**
 * Create new user via API
 * 
 * @test request: POST /api/users with valid data
 * @test call: Validate email format
 * 
 * @expect status: 201 Created
 * @expect body: Contains user ID and email
 * @expect db: User row created in database
 * @expect event: 'user.created' event emitted
 */
async createUser(data) {
  // ...
}
\`\`\`

## 3. General Coding Rules
- **ESM Only**: Use \`import\` / \`export\`. No \`require\`.
- **No Dependencies**: Avoid adding new npm packages unless critical.
- **Comments**: Write clear JSDoc for all public methods.
- **Async/Await**: Prefer async/await over promises.

## 4. MCP Tools Usage
- **Graph**: Use \`get_skeleton\` first to map the codebase.
- **Deep Dive**: Use \`expand\` to read class details.
- **Tests**: Use \`get_pending_tests\` to see what needs verification.
- **Guidelines**: Use \`get_agent_instructions\` to refresh these rules.

## 5. Custom Rules System
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

/**
 * Get agent instructions
 * @returns {string}
 */
export function getInstructions() {
  return AGENT_INSTRUCTIONS;
}
