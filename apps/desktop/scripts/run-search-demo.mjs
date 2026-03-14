/* global console */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const { HybridSearchService } = await import(
  path.join(repoRoot, 'apps/desktop/dist/main/search/hybridSearch.js')
);

class FakeDb {
  listAssetsForSearch() {
    return [
      {
        assetId: 'dashboard-1',
        title: 'B2B Analytics Dashboard',
        userNote: 'Dense KPI cards and side nav',
        retrievalCaption: 'Dashboard UI with blue cards and table.',
        tags: ['dashboard', 'analytics'],
        collections: ['product'],
        status: 'ready',
        mime: 'image/png',
        createdAt: '2026-01-01T00:00:00.000Z',
        dominantColors: ['blue'],
        orientation: 'landscape',
        aspectBucket: 'wide',
        hasText: true
      },
      {
        assetId: 'editorial-1',
        title: 'Editorial Portfolio',
        userNote: 'Serif hero and asymmetric grid',
        retrievalCaption: 'Editorial website with muted palette.',
        tags: ['portfolio', 'editorial'],
        collections: ['inspiration'],
        status: 'ready',
        mime: 'image/png',
        createdAt: '2026-01-02T00:00:00.000Z',
        dominantColors: ['gray'],
        orientation: 'portrait',
        aspectBucket: 'portrait',
        hasText: false
      }
    ];
  }

  listEmbeddings(role) {
    const data = {
      visual: [
        { assetId: 'dashboard-1', vector: [1, 0, 0] },
        { assetId: 'editorial-1', vector: [0, 1, 0] }
      ],
      text: [
        { assetId: 'dashboard-1', vector: [0.9, 0.1, 0] },
        { assetId: 'editorial-1', vector: [0.1, 0.9, 0] }
      ],
      joint: [
        { assetId: 'dashboard-1', vector: [0.95, 0.05, 0] },
        { assetId: 'editorial-1', vector: [0.15, 0.85, 0] }
      ],
      chunk: []
    };
    return data[role] ?? [];
  }

  getAssetSearchDocument(assetId) {
    const docs = {
      'dashboard-1': 'kpi analytics table cards navigation dashboard metrics',
      'editorial-1': 'portfolio serif editorial magazine asymmetry'
    };
    return docs[assetId] ?? '';
  }
}

const service = new HybridSearchService(new FakeDb());
const visualQuery = service.search({
  mode: 'similarity',
  vectors: { visual: [1, 0, 0], joint: [1, 0, 0] },
  filters: { onlyOfflineReady: true }
});
const textQuery = service.search({
  mode: 'exploration',
  text: 'serif editorial portfolio',
  vectors: { text: [0, 1, 0], joint: [0, 1, 0] },
  filters: { onlyOfflineReady: true }
});
const filteredQuery = service.search({
  mode: 'exploration',
  text: 'dashboard blue text',
  vectors: { text: [1, 0, 0], joint: [1, 0, 0] },
  filters: {
    onlyOfflineReady: true,
    orientation: 'landscape',
    dominantColors: ['blue'],
    hasText: true,
    collectionNames: ['product']
  }
});

const payload = {
  generatedAt: new Date().toISOString(),
  scenarios: [
    {
      name: 'Similarity mode (image-like query)',
      query: 'visual=[1,0,0], joint=[1,0,0]',
      results: visualQuery
    },
    {
      name: 'Exploration mode (text query)',
      query: '"serif editorial portfolio"',
      results: textQuery
    },
    {
      name: 'Filtered archive query',
      query: '"dashboard blue text" + landscape + blue + has-text + product collection',
      results: filteredQuery
    }
  ]
};

const artifactsDir = path.join(repoRoot, 'docs/artifacts');
await fs.mkdir(artifactsDir, { recursive: true });
await fs.writeFile(
  path.join(artifactsDir, 'embedding-demo.json'),
  JSON.stringify(payload, null, 2)
);

const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Embedding Demo</title>
<style>body{font-family:Inter,Arial,sans-serif;padding:24px;background:#0b1020;color:#f6f7fb} .card{background:#141b34;border:1px solid #2f3b66;border-radius:12px;padding:16px;margin:0 0 16px;} code{background:#222c50;padding:2px 6px;border-radius:6px;} .result{padding:10px 0;border-top:1px solid #2a3359;} .score{color:#8bd2ff;font-weight:700} .meta{color:#cbd5f5;font-size:13px;line-height:1.45;margin-top:4px}</style></head>
<body><h1>Gemini Retrieval Proof Artifact</h1><p>Generated: ${payload.generatedAt}</p>
${payload.scenarios.map((scenario) => `<div class="card"><h2>${scenario.name}</h2><p>Query: <code>${scenario.query}</code></p>${scenario.results.map((r, i) => `<div class="result"><strong>#${i + 1} ${r.assetId}</strong> — <span class="score">${r.score.toFixed(4)}</span><br/>Reasons: ${r.reasons.join(', ')}<div class="meta">fields: ${r.explanation.matchedFields.join(', ') || 'none'}<br/>terms: ${r.explanation.matchedTerms.join(', ') || 'none'}<br/>tags: ${r.explanation.matchedTags.join(', ') || 'none'}<br/>collections: ${r.explanation.matchedCollections.join(', ') || 'none'}<br/>snippet: ${r.explanation.snippet}</div></div>`).join('')}</div>`).join('')}
</body></html>`;

await fs.writeFile(path.join(artifactsDir, 'embedding-demo.html'), html);
console.log('Wrote docs/artifacts/embedding-demo.json and docs/artifacts/embedding-demo.html');
