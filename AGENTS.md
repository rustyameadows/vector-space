# Agent Working Agreement

## Purpose
Repository-level guidance for implementation and handoff quality.

## Definition of Done for Feature PRs
- Feature behavior implemented.
- Validation completed.
- Docs updated if behavior, interfaces, or scope changed.
- Handoff includes what changed and how it was verified.
- Interfaces/types reflected in docs.
- Decision recorded when architecture or product direction changed.
- No stale contradictions across docs.
- UI-impacting changes verified in-browser via Chrome MCP before handoff.
- For UI or visual polish changes, do not claim completion until you have personally reviewed fresh screenshots or live Chrome MCP output from the changed surface. If the user is asking about layout/styling, include those screenshots in the handoff.
- When presenting completed work to the user for repo code changes or app-behavior changes, build a fresh mac app artifact with `npm run package:mac` and report the resulting `.app` and `.zip` paths in the handoff.
- Do not run `npm run package:mac` for Paper MCP-only work, design-only tasks, copy-only tasks, or other requests that do not change the app code in this repository.
