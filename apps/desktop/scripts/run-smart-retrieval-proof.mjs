/* global console */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..', '..');

const [{ LocalAssetEnrichmentService }, { HybridSearchService }, { GEMINI_EXTRACTION_VERSION }] =
  await Promise.all([
    import(path.join(repoRoot, 'apps/desktop/dist/main/services/assetEnrichment.js')),
    import(path.join(repoRoot, 'apps/desktop/dist/main/search/hybridSearch.js')),
    import(path.join(repoRoot, 'apps/desktop/dist/shared/gemini.js'))
  ]);

const artifactsDir = path.join(repoRoot, 'docs/artifacts');
await fs.mkdir(artifactsDir, { recursive: true });

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vector-space-smart-proof-'));
const proofImagePath = path.join(tempDir, 'ocr-proof.png');

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
await page.setContent(`
  <style>
    body { margin: 0; background: #f7f7f7; display: grid; place-items: center; width: 100vw; height: 100vh; }
    main {
      width: 1040px;
      height: 760px;
      display: grid;
      place-items: center;
      background: white;
      border: 24px solid #0f172a;
      border-radius: 28px;
      box-shadow: 0 24px 80px rgba(15, 23, 42, 0.18);
    }
    .poster {
      transform: rotate(180deg);
      font-family: Arial, Helvetica, sans-serif;
      font-size: 110px;
      font-weight: 700;
      letter-spacing: 0.08em;
      color: #111827;
      text-transform: uppercase;
      text-align: center;
      line-height: 1.05;
    }
  </style>
  <main>
    <div class="poster">Archive<br/>Search</div>
  </main>
`);
await page.locator('main').screenshot({ path: proofImagePath });
await browser.close();

const enrichmentService = new LocalAssetEnrichmentService();
const enrichment = await enrichmentService.extract({
  assetId: 'proof-asset',
  imagePath: proofImagePath,
  sourcePath: '/Users/example/Archive/Search/archive-search-proof.png',
  width: 1040,
  height: 760,
  extractionVersion: GEMINI_EXTRACTION_VERSION
});

class FakeDb {
  listAssetsForSearch() {
    return [
      {
        assetId: 'poster-source',
        title: 'Archive Search Poster',
        userNote: 'Rotated poster study',
        retrievalCaption: 'Poster layout with strong typography.',
        tags: ['poster', 'typography'],
        collections: ['archive'],
        status: 'ready',
        mime: 'image/png',
        createdAt: '2026-03-14T00:00:00.000Z',
        dominantColors: ['white', 'black'],
        orientation: 'landscape',
        aspectBucket: 'standard',
        hasText: true,
        ocrText: enrichment.ocrText,
        pathTokens: enrichment.pathTokens
      },
      {
        assetId: 'poster-neighbor',
        title: 'Editorial Poster',
        userNote: 'Typography-heavy poster',
        retrievalCaption: 'Editorial poster with bold text blocks.',
        tags: ['poster', 'editorial'],
        collections: ['archive'],
        status: 'ready',
        mime: 'image/png',
        createdAt: '2026-03-12T00:00:00.000Z',
        dominantColors: ['white', 'black'],
        orientation: 'landscape',
        aspectBucket: 'standard',
        hasText: true,
        ocrText: 'editorial archive poster',
        pathTokens: ['archive', 'editorial', 'poster']
      },
      {
        assetId: 'catalog-ui',
        title: 'Catalog UI',
        userNote: 'Clean interface with cards',
        retrievalCaption: 'Product catalog interface.',
        tags: ['ui', 'product'],
        collections: ['interface'],
        status: 'ready',
        mime: 'image/png',
        createdAt: '2026-03-10T00:00:00.000Z',
        dominantColors: ['blue'],
        orientation: 'landscape',
        aspectBucket: 'wide',
        hasText: false,
        ocrText: '',
        pathTokens: ['catalog', 'ui']
      }
    ];
  }

  listEmbeddings(role) {
    const data = {
      visual: [
        { assetId: 'poster-source', vector: [1, 0, 0] },
        { assetId: 'poster-neighbor', vector: [0.94, 0.06, 0] },
        { assetId: 'catalog-ui', vector: [0.1, 0.9, 0] }
      ],
      text: [
        { assetId: 'poster-source', vector: [1, 0, 0] },
        { assetId: 'poster-neighbor', vector: [0.88, 0.12, 0] },
        { assetId: 'catalog-ui', vector: [0.08, 0.92, 0] }
      ],
      joint: [
        { assetId: 'poster-source', vector: [1, 0, 0] },
        { assetId: 'poster-neighbor', vector: [0.92, 0.08, 0] },
        { assetId: 'catalog-ui', vector: [0.05, 0.95, 0] }
      ],
      chunk: []
    };

    return data[role] ?? [];
  }

  getAssetSearchDocument(assetId) {
    const docs = {
      'poster-source': `${enrichment.ocrText} archive search poster typography`,
      'poster-neighbor': 'editorial archive poster bold text treatment',
      'catalog-ui': 'catalog ui product cards'
    };

    return docs[assetId] ?? '';
  }
}

const searchService = new HybridSearchService(new FakeDb());
const ocrQueryResults = searchService.search({
  mode: 'exploration',
  text: 'archive search typography',
  vectors: { text: [1, 0, 0], joint: [1, 0, 0] },
  filters: { onlyOfflineReady: true, hasText: true }
});
const similarResults = searchService.search({
  mode: 'similarity',
  vectors: { visual: [1, 0, 0], joint: [1, 0, 0] },
  filters: { onlyOfflineReady: true }
}).filter((result) => result.assetId !== 'poster-source');

const payload = {
  generatedAt: new Date().toISOString(),
  ocrProbe: {
    imagePath: proofImagePath,
    extractedText: enrichment.ocrText,
    ocrLines: enrichment.ocrLines,
    ocrRotation: enrichment.ocrRotation,
    pathTokens: enrichment.pathTokens,
    hasText: enrichment.hasText
  },
  scenarios: [
    {
      name: 'Exploration query with OCR terms',
      query: 'archive search typography',
      results: ocrQueryResults
    },
    {
      name: 'Similar-image ranking from poster source',
      query: 'visual=[1,0,0], joint=[1,0,0]',
      results: similarResults
    }
  ]
};

await fs.writeFile(
  path.join(artifactsDir, 'smart-retrieval-proof.json'),
  JSON.stringify(payload, null, 2)
);

const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Smart Retrieval Proof</title>
    <style>
      body { font-family: Inter, Arial, sans-serif; padding: 24px; background: #0b1220; color: #e5edf9; }
      .card { background: #121b2b; border: 1px solid #23324d; border-radius: 16px; padding: 18px; margin-bottom: 18px; }
      .meta { color: #9db0cf; font-size: 13px; line-height: 1.55; }
      .result { border-top: 1px solid #20304d; padding-top: 10px; margin-top: 10px; }
      .score { color: #8bd2ff; font-weight: 700; }
      code { background: #162338; padding: 2px 6px; border-radius: 6px; }
    </style>
  </head>
  <body>
    <h1>Smart Retrieval Proof</h1>
    <p>Generated: ${payload.generatedAt}</p>
    <div class="card">
      <h2>OCR Probe</h2>
      <p class="meta">Rotation used: <code>${payload.ocrProbe.ocrRotation}</code> · Has text: <code>${String(payload.ocrProbe.hasText)}</code></p>
      <p><strong>Extracted text</strong></p>
      <p>${payload.ocrProbe.extractedText || 'No text extracted'}</p>
      <p class="meta">Path tokens: ${payload.ocrProbe.pathTokens.join(', ') || 'none'}</p>
    </div>
    ${payload.scenarios
      .map(
        (scenario) => `<div class="card">
          <h2>${scenario.name}</h2>
          <p>Query: <code>${scenario.query}</code></p>
          ${scenario.results
            .map(
              (result, index) => `<div class="result">
                <strong>#${index + 1} ${result.assetId}</strong> — <span class="score">${result.score.toFixed(4)}</span>
                <div class="meta">
                  reasons: ${result.reasons.join(', ')}<br/>
                  fields: ${result.explanation.matchedFields.join(', ') || 'none'}<br/>
                  tags: ${result.explanation.matchedTags.join(', ') || 'none'}<br/>
                  OCR terms: ${result.explanation.matchedOcrTerms.join(', ') || 'none'}<br/>
                  path terms: ${result.explanation.matchedPathTerms.join(', ') || 'none'}<br/>
                  snippet: ${result.explanation.snippet}
                </div>
              </div>`
            )
            .join('')}
        </div>`
      )
      .join('')}
  </body>
</html>`;

await fs.writeFile(path.join(artifactsDir, 'smart-retrieval-proof.html'), html);
console.log('Wrote docs/artifacts/smart-retrieval-proof.json and smart-retrieval-proof.html');
