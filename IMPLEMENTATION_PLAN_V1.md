# V1 Implementation Plan — Personal Visual Archive (Mac Electron App)

## 1) Objective
Ship a macOS-only, local-first Electron app that lets a solo designer import visual assets, store them durably, index them, and retrieve them quickly via semantic, visual-similarity, and filter-based search (including offline retrieval for already-indexed items).

## 2) Scope Baseline (MVP)
### Must-have capabilities
- Managed local library with copied originals
- Import: drag/drop, file picker, folder ingest, paste from clipboard
- Stable asset IDs + file hash duplicate detection
- Thumbnail generation and fast grid browsing
- Local metadata DB + local vector search storage
- Cloud embedding generation via Gemini Embedding 2 (abstracted provider)
- Search modes:
  - semantic text query
  - image-to-image similarity (existing or uploaded image)
  - filter workflows (color/type/metadata)
- Lightweight organization: collections + manual tags
- Offline browsing + retrieval for previously indexed assets

### Defer to post-MVP
- Sync/backup service
- Collaboration/sharing
- Browser extension / Figma plugin / iPhone app
- Video archive

## 3) Technical Decisions (V1)
- **Desktop shell:** Electron + React + TypeScript
- **Data/storage:**
  - Managed library directory on disk for originals/derivatives
  - SQLite metadata store
  - SQLite vector extension (or equivalent local vector-capable path)
- **Indexing architecture:** background job queue in main process worker(s)
- **Embeddings:** Gemini provider behind internal interface (versioned)
- **Search execution:** local hybrid retrieval/ranking over metadata + vectors

## 4) Data Model (Initial)
Define migrations for:
- `assets` (id, created_at, import_source, mime, width, height, checksum, status)
- `asset_files` (asset_id, role: original/derivative, local_path, size, format)
- `thumbnails` (asset_id, variant, local_path, width, height)
- `embeddings` (asset_id, provider, model, vector_dim, vector_blob, created_at, version)
- `collections`, `collection_assets`
- `tags`, `asset_tags`
- `index_jobs` (asset_id, stage, status, retries, error, timestamps)

## 5) Retrieval & Ranking (V1)
Hybrid ranking score combines:
1. embedding similarity (primary)
2. text match against user metadata + optional OCR/caption
3. filter adherence (type/color/date/collection/tag)
4. optional recency boost (lightweight)

Expose match reasons in UI:
- similar visual embedding
- matching terms/caption/OCR
- matching color profile
- shared type/category/tag

## 6) Workstreams and Milestones

## Milestone A — Foundations (Week 1)
- Scaffold Electron + React + TS app shell
- Define app folder conventions and managed library root
- Build DB bootstrap + migration framework
- Define domain types for Asset, ImportJob, Embedding, SearchQuery

**Exit criteria:** app launches, DB initializes, library root configured.

## Milestone B — Ingestion Pipeline (Weeks 2–3)
- Implement import adapters:
  - drag/drop
  - file picker
  - folder bulk import
  - clipboard paste
- Copy originals to managed storage
- Compute checksum + dedupe (hash-level)
- Generate thumbnails
- Record import provenance + indexing status

**Exit criteria:** can import 100+ mixed images and browse generated thumbs.

## Milestone C — Indexing + Embeddings (Weeks 3–4)
- Background indexing queue with retries and visible states
- Provider abstraction (`EmbeddingProvider`) + Gemini implementation
- Persist embedding vectors with provider/model/version metadata
- Support pause/resume and reindex-by-model-version

**Exit criteria:** imported assets become searchable semantically after indexing.

## Milestone D — Search UX + Retrieval (Weeks 4–5)
- Global search bar + filter panel
- Semantic text search endpoint
- Similar-image search:
  - from asset detail pivot
  - from uploaded query image
- Color and type filters
- “Why this matched” explanation chips

**Exit criteria:** common query latency under ~2s on personal-scale library.

## Milestone E — Organization + Offline Guarantees (Week 6)
- Collections CRUD + tagging
- Saved searches/filters (if timeline permits)
- Offline mode behavior:
  - browse local assets
  - run local vector+metadata retrieval
  - gracefully skip new cloud enrichments

**Exit criteria:** offline retrieval works for already-indexed assets.

## Milestone F — Hardening + V1 Ship Readiness (Week 7)
- Performance passes (import throughput, query latency)
- Error handling and resilience (partial ingest failures, corrupted files)
- Empty states + first-run guidance
- Packaging/signing pipeline for mac build

**Exit criteria:** release candidate built, smoke-tested, and documented.

## 7) Suggested Issue Backlog (Implementation-ready)
1. App shell bootstrap (Electron/React/TS) + process boundaries
2. Library path manager + storage layout contract
3. DB schema + migration runner
4. Import service (file/folder/drag/paste)
5. Thumbnail worker service
6. Hashing + duplicate detector
7. Indexing queue + job state UI
8. Embedding provider abstraction + Gemini adapter
9. Local vector retrieval layer + similarity API
10. Search API (semantic + hybrid ranking)
11. Filter system (color/type/date/collection/tag)
12. Asset detail pane + find-similar action
13. Collections + tags + saved searches
14. Offline mode handling + network-state UX
15. Reindex flow for provider/model version upgrades
16. Observability/logging for import/index/search performance
17. Packaging + release artifact workflow

## 8) Open Questions / Decisions to Resolve Early
- Exact file type support for V1 beyond common images
- Duplicate strategy beyond exact hash (perceptual matching later?)
- OCR and AI captions default visibility
- Whether to store original folder path metadata for context
- Max tested library size target (e.g., 10k, 25k, 50k assets)

## 9) Acceptance Criteria for Plan Completion
- Product direction accepted (local-first personal archive)
- MVP scope frozen with explicit non-goals
- Architecture approved (Electron + local DB + local vector + cloud embeddings)
- Open questions assigned or deferred with owner/date
- Backlog issues created from sections 6–8
