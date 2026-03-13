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

## Explicit handoff artifact requirements (new)
- If retrieval/search/embeddings behavior changes, include **at least one runnable proof artifact** in the handoff (test output, generated report, or both) that demonstrates ranking behavior with concrete inputs and outputs.
- If the request asks to “show it working” (or equivalent), provide:
  1. passing automated tests that exercise the changed behavior,
  2. a human-readable artifact (JSON/HTML/markdown report), and
  3. at least one screenshot of that artifact or changed UI surface captured through Chrome MCP.
- Any feature PR touching app behavior should include a short “How to reproduce proof” command list in docs or the final handoff.
