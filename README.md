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
- Embedding provider abstraction using Gemini Embedding API.
- Local vector retrieval for semantic and similar-image search.
- Filtering, match-reason explanations, collection + tag organization.
- Offline mode toggle preserving local browse and retrieval behavior.

## Quality checks

```bash
npm run lint
npm run typecheck
npm run build
```
