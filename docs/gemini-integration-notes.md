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
  - `content.parts[]` with `text` or `inlineData`
- Response field consumed: `embedding.values[]`

## Verification executed in this repository

Endpoint and request shape validated from this environment using `curl`:

```bash
curl -sS -o /tmp/gemini_probe.json -w "%{http_code}" \
  -X POST "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=INVALID" \
  -H "Content-Type: application/json" \
  -d '{"model":"models/gemini-embedding-001","content":{"parts":[{"text":"probe"}]}}'
```

This returns expected auth error for invalid key, confirming endpoint path, method, and payload envelope alignment.
