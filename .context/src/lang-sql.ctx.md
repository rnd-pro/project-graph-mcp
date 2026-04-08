# lang-sql.js

## Notes
- Parses `.sql` files (schema dumps) and extracts SQL queries embedded in code strings.
- Extracts tables, columns, reads (SELECT/JOIN), and writes (INSERT/UPDATE/DELETE).
- Highly reliant on `SQL_KEYWORDS` to filter out false positives from regex extraction.

## Edge Cases
- Accuracy is ~80%; it relies on regex and can miss dynamic or heavily obfuscated SQL queries.
- Removes `DELETE` primary targets from `reads` to avoid double-counting mutations.
- Rejects PascalCase and ALL-UPPERCASE table names to avoid catching constants or classes.

## Decisions
- Chose a zero-dependency regex approach instead of a full SQL AST parser for performance and simplicity across dialects.
- Extracts queries directly from raw source code (Python/Go/JS) before comments/strings are stripped.

## TODO
- Enhance parsing for complex subqueries and CTEs (`WITH` clauses).
