# framework-references.js

## Notes
- Loads framework-specific AI documentation/references (e.g., Symbiote.js) to provide context to agents.
- Fetches references from remote GitHub URLs with a 1-hour in-memory cache, falling back to local files in the `references/` directory.
- Auto-detects the project's framework using `custom-rules.js` and loads the appropriate reference.

## Edge Cases
- Remote fetch has a strict 5000ms timeout (`AbortSignal.timeout`) to prevent the CLI from hanging if GitHub is unreachable.
- Fails silently and falls back to local files if the network request fails or if local file writing fails.

## Decisions
- Selected an in-memory cache with file-system backup to ensure agents always have access to framework rules, even when offline.
- Used a predefined map (`REMOTE_SOURCES`) for known framework URLs rather than fetching dynamically to ensure security and predictability.

## TODO
- Support fetching references from a central registry or allowing projects to define their own remote references in `package.json`.
