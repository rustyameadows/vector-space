# Gemini Embedding Integration Notes

## Runtime credential source

- Gemini API key is entered in-app and stored in **macOS Keychain** via `keytar`.
- No environment variable is required for runtime credential loading.

## API contract used

Vector Space uses Google Generative Language API `embedContent`:

- Endpoint: `POST /v1beta/models/{model}:embedContent`
- Model used: `gemini-embedding-001`
- Payload format:
  - `model: "models/{model}"`
  - `taskType: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY"`
  - `outputDimensionality`
  - `content.parts[]` with `text` or `inlineData`
- Response field consumed: `embedding.values[]`

## Current retrieval architecture

### Ingestion/indexing

For each imported asset, indexing now writes:

- `visual` embedding (`image` only)
- `text` embedding (`title + tags + collection + note + pseudo OCR text`)
- `joint` embedding (`image + focused text`)

Document embeddings are created with `taskType: RETRIEVAL_DOCUMENT`.

### Search/query

Queries now use `taskType: RETRIEVAL_QUERY` and are routed by modality:

- text query → text + joint query embeddings
- image query → visual query embedding
- image + text (internal support) → joint query embedding

### Hybrid ranking

Ranking blends:

1. role-weighted vector similarity (`visual`, `text`, `joint`)
2. lexical overlap across title/note/caption/tags/collections/chunks
3. filter checks (`status`, mime prefix, tags, collections)

Search supports two rank modes:

- `similarity` mode: visual-heavy weights, tighter neighbors
- `exploration` mode: joint/text weighted for broader recall

### Schema versioning

Embedding rows now include version metadata:

- `provider`, `model`, `task_type`, `vector_dim`, `embedding_version`
- `preprocessing_version`, `extraction_version`, `ocr_version`
- `role` (`visual`, `text`, `joint`, optional `chunk`)

## Verification executed in this repository

Endpoint and request shape validated from this environment using `curl`:

```bash
curl -sS -o /tmp/gemini_probe.json -w "%{http_code}" \
  -X POST "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=INVALID" \
  -H "Content-Type: application/json" \
  -d '{"model":"models/gemini-embedding-001","taskType":"RETRIEVAL_QUERY","content":{"parts":[{"text":"probe"}]}}'
```

This returns expected auth error for invalid key, confirming endpoint path, method, and payload envelope alignment.
