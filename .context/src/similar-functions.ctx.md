# similar-functions.js

## Notes
- Detects functionally similar code blocks to identify copy-paste duplication
- Compares functions based on parameter count, parameter names, async status, control flow structure, and internal function calls
- Uses a tokenized body hash (e.g., `IF|FOR|TRY|RET`) to abstract away variable names and focus on control flow shape
- Maximum similarity score is 100, weighted heavily towards matching param counts and body structures

## Edge Cases
- Extremely small functions (body hash < 3 tokens) are ignored to prevent noise from simple getters/setters
- Functions with the exact same name in the same file are skipped, assuming they are intentional overloads
- Destructured parameters and rest elements are simplified to their base identifiers for comparison
- Arrow functions assigned to variables aren't currently analyzed, only declarations and methods

## Decisions
- Structural hashing over raw text comparison allows detecting similar logic even when variable names differ
- Scoring breakdown (params: 50%, structure: 25%, calls: 15%, async: 10%) was tuned to favor semantic similarity over pure syntax

## TODO
- Add support for variable-assigned arrow functions
- Implement AST normalization to catch logically identical blocks with different loop types (e.g., `for` vs `forEach`)