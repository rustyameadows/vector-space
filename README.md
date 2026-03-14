# Vector Space

Local-first macOS Electron app for a personal visual archive.

## Requirements

- Node.js 20 LTS (`20.20.1` verified in this repo)
- npm 10+
- Xcode Command Line Tools (`xcode-select --install`)
- Gemini API key from Google AI Studio for `gemini-embedding-2-preview`

## Getting started

```bash
npm install
npm run dev
```

If you use `nvm`, run `nvm use` first. Otherwise install Node 20 LTS and confirm `node -v` prints a `v20.x` release before running `npm install`.

`npm install` now rebuilds the native desktop modules for the checked-in Electron version automatically.

## Gemini API key setup (macOS keychain)

This app does **not** use environment variables for API credentials.

The app uses exactly `gemini-embedding-2-preview` for embeddings. There is no alternate embedding model switch or fallback in the app.

Use the in-app **Gemini API Key** panel to:

1. Paste your Google Gemini API key.
2. Click **Save Key**.
3. The key is saved into macOS Keychain and used for indexing/search embeddings.

You can remove it anytime with **Clear Key**.

## Supported image imports

- `png`
- `jpg`
- `jpeg`
- `gif`
- `webp`
- `bmp`
- `tiff`
- `tif`

Imported assets now generate aspect-ratio-preserving grid thumbnails. Existing stretched grid thumbnails are repaired automatically on app launch.

## Build

```bash
npm run build
```

Import-format proof:

```bash
npm run proof:imports --workspace @vector-space/desktop
npm run smoke:electron --workspace @vector-space/desktop
```

## Package mac artifact

```bash
npm run package:mac
```

That command now:

- builds the app,
- rebuilds `better-sqlite3` and `keytar` for the installed Electron version,
- packages for the current Mac architecture by default (`arm64` on Apple Silicon, `x64` on Intel),
- writes both a `.app` bundle and a `.zip` into `apps/desktop/release/`.

If you need an Intel build from an Apple Silicon machine, pass the target explicitly:

```bash
npm run package:mac --workspace @vector-space/desktop -- --arch=x64
```

## Implemented V1 capabilities

- Managed local library with deterministic asset and thumbnail storage.
- Import from file picker, folder ingest, drag/drop, and clipboard paste.
- SHA-256 duplicate detection and metadata persistence in SQLite.
- Thumbnail generation and fast renderer grid browsing.
- Startup thumbnail maintenance that repairs legacy stretched grid previews in the background.
- Adjustable `2` to `10` up library grid with a `6` up default, hover-revealed card metadata, and a single-asset viewer overlay opened from the grid.
- Background indexing queue with pause/resume/reindex controls.
- Gemini embedding pipeline pinned to `gemini-embedding-2-preview` with role-specific vectors (`visual`, `text`, `joint`).
- Query/document task-type split for higher quality retrieval (`RETRIEVAL_DOCUMENT` vs `RETRIEVAL_QUERY`).
- Hybrid retrieval blending vector similarity with lexical matching and metadata filters.
- Chunked text sidecar storage for better long-text and OCR-oriented recall.
- Embedding schema version metadata to enable safe re-indexing over time.
- Offline mode toggle preserving local browse and retrieval behavior.

## Quality checks

```bash
npm run lint
npm run typecheck
npm test
npm run proof:imports --workspace @vector-space/desktop
npm run smoke:electron --workspace @vector-space/desktop
npm run proof:model-lock --workspace @vector-space/desktop
npm run build
```

## How To Reproduce Upload Proof

```bash
nvm use
npm install
npm test
npm run proof:imports --workspace @vector-space/desktop
npm run smoke:electron --workspace @vector-space/desktop
npm run proof:model-lock --workspace @vector-space/desktop
npm run package:mac
```
