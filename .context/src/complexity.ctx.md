# complexity.js

## Notes
- Measures cyclomatic complexity of functions, methods, and arrow functions via AST traversal
- Complexity increments on decision points: `if`, `for`, `while`, `case`, `&&`, `||`, `??`, `catch`, and ternaries
- Rates complexity in four tiers: low (<=5), moderate (<=10), high (<=20), and critical (>20)
- Exposes `analyzeComplexityFile` for per-file cache integration

## Edge Cases
- Arrow functions without block statements (implicit returns) are skipped entirely
- Arrow functions with block statements are only reported if complexity > 5 to reduce noise
- Switch `default` cases do not increase complexity score
- Syntax errors cause the file to be silently skipped

## Decisions
- Arrow function threshold (>5) chosen to prevent cluttering reports with simple callbacks or array methods
- Base complexity starts at 1, representing the single path through a straight-line function

## TODO
- Add cognitive complexity calculation as an alternative metric
- Support configuring complexity rating thresholds via project config