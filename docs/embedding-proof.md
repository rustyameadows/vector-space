# Embedding & Search Proof Artifacts

This doc provides a reproducible proof path for the multimodal/hybrid retrieval stack.

## Reproduce

```bash
npm run build
npm run test
node apps/desktop/scripts/run-search-demo.mjs
```

## Generated artifacts

- `docs/artifacts/embedding-demo.json` — machine-readable output from the real `HybridSearchService` class.
- `docs/artifacts/embedding-demo.html` — visual report showing ranked results/reasons for:
  - similarity-mode vector query
  - exploration-mode text query

## What to inspect

- Similarity scenario should rank `dashboard-1` first due to visual/joint alignment.
- Exploration scenario should rank `editorial-1` first with lexical reason included.
