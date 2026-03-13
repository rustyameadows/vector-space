# Vector Space

Local-first macOS Electron app for a personal visual archive.

## Requirements

- Node.js 20+
- npm 10+
- Gemini API key from Google AI Studio

## Getting started

```bash
npm install
npm run dev
```

## Gemini API key setup (macOS keychain)

This app does **not** use environment variables for API credentials.

Use the in-app **Gemini API Key** panel to:

1. Paste your Google Gemini API key.
2. Click **Save Key**.
3. The key is saved into macOS Keychain and used for indexing/search embeddings.

You can remove it anytime with **Clear Key**.

## Build

```bash
npm run build
```

## Package mac artifact

```bash
npm run package:mac --workspace @vector-space/desktop
```

## Implemented V1 capabilities

- Managed local library with deterministic asset and thumbnail storage.
- Import from file picker, folder ingest, drag/drop, and clipboard paste.
- SHA-256 duplicate detection and metadata persistence in SQLite.
- Thumbnail generation and fast renderer grid browsing.
- Background indexing queue with pause/resume/reindex controls.
- Gemini multimodal embedding pipeline with role-specific vectors (`visual`, `text`, `joint`).
- Query/document task-type split for higher quality retrieval (`RETRIEVAL_DOCUMENT` vs `RETRIEVAL_QUERY`).
- Hybrid retrieval blending vector similarity with lexical matching and metadata filters.
- Chunked text sidecar storage for better long-text and OCR-oriented recall.
- Embedding schema version metadata to enable safe re-indexing over time.
- Offline mode toggle preserving local browse and retrieval behavior.

## Quality checks

```bash
npm run lint
npm run typecheck
npm run build
```
