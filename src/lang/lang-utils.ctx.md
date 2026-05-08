# lang-utils.js

## Notes
- Core string and comment stripping utility (`stripStringsAndComments`).
- Preserves the exact character positions and line structures (newlines and spaces are kept) so that line numbers match the original source code after regex parsing.
- Used universally by all regex-based parsers (`lang-typescript.js`, `lang-python.js`, `lang-go.js`).

## Edge Cases
- Handles Python hash `#` and triple-quotes `'''`, `"""` conditionally based on options.
- Retains template literal interpolation expressions (`${...}`) to avoid stripping executable code within backticks.
- Does not parse complex nested strings inside template literals perfectly if braces are mismatched.

## Decisions
- Replaced actual string content with spaces instead of removing it to ensure that subsequent regex matches report the correct line and column indices.

## TODO
- Add support for nested template literals spanning multiple lines.
