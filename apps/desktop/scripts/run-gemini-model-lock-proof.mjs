/* global console */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(__dirname, '..');
const distDir = path.join(appDir, 'dist');
const reportDir = path.join(appDir, 'artifacts', 'gemini-model-lock');

const {
  GEMINI_EMBEDDING_MODEL,
  GEMINI_EMBEDDING_VERSION,
  getGeminiApiSettings
} = await import(path.join(distDir, 'shared/gemini.js'));
const { GeminiEmbeddingProvider } = await import(
  path.join(distDir, 'main/embedding/provider.js')
);
const { ImportService } = await import(path.join(distDir, 'main/services/importService.js'));

const samplePngBase64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO8B2lQAAAAASUVORK5CYII=';

class FakeDb {
  constructor() {
    this.inserts = [];
  }

  findAssetByChecksum() {
    return null;
  }

  insertAsset(asset, originalPath, originalSize, thumbPath, metadata) {
    this.inserts.push({ asset, originalPath, originalSize, thumbPath, metadata });
  }
}

const originalHome = process.env.HOME;
const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'vector-space-gemini-lock-'));

try {
  process.env.HOME = tempRoot;

  const inputDir = path.join(tempRoot, 'input');
  await fs.mkdir(inputDir, { recursive: true });

  const samplePath = path.join(inputDir, 'sample.png');
  await fs.writeFile(samplePath, Buffer.from(samplePngBase64, 'base64'));

  const fakeDb = new FakeDb();
  const importService = new ImportService(fakeDb);
  const importResult = await importService.importPaths([samplePath], 'file-picker');
  const inserted = fakeDb.inserts[0];
  const provider = new GeminiEmbeddingProvider({ apiKey: 'demo-key' });
  const apiSettings = getGeminiApiSettings(true);
  const metadata = JSON.parse(inserted.metadata.metadataJson);

  const payload = {
    generatedAt: new Date().toISOString(),
    input: {
      samplePath,
      imported: importResult
    },
    outputs: {
      configuredModel: GEMINI_EMBEDDING_MODEL,
      providerModel: provider.model,
      apiSettings,
      importEmbeddingVersion: metadata.embeddingVersion,
      importedMime: inserted.asset.mime,
      thumbnailPath: inserted.thumbPath
    },
    checks: {
      providerModelLocked: provider.model === GEMINI_EMBEDDING_MODEL,
      apiSettingsLocked: apiSettings.model === GEMINI_EMBEDDING_MODEL,
      importMetadataLocked: metadata.embeddingVersion === GEMINI_EMBEDDING_VERSION
    }
  };

  await fs.mkdir(reportDir, { recursive: true });
  await fs.writeFile(path.join(reportDir, 'report.json'), JSON.stringify(payload, null, 2));

  const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Gemini Model Lock Proof</title>
    <style>
      body { font-family: Inter, Arial, sans-serif; margin: 24px; color: #101828; background: #f8fafc; }
      .card { background: #ffffff; border: 1px solid #d0d5dd; border-radius: 12px; padding: 16px; margin-bottom: 16px; }
      code { background: #eef2ff; border-radius: 6px; padding: 2px 6px; }
      .pass { color: #067647; font-weight: 700; }
      .grid { display: grid; gap: 8px; }
    </style>
  </head>
  <body>
    <h1>Gemini Model Lock Proof</h1>
    <p>Generated: ${payload.generatedAt}</p>
    <div class="card">
      <h2>Concrete input/output</h2>
      <div class="grid">
        <div>Input sample: <code>${payload.input.samplePath}</code></div>
        <div>Configured model: <code>${payload.outputs.configuredModel}</code></div>
        <div>Provider model: <code>${payload.outputs.providerModel}</code></div>
        <div>API settings model: <code>${payload.outputs.apiSettings.model}</code></div>
        <div>Imported metadata version: <code>${payload.outputs.importEmbeddingVersion}</code></div>
        <div>Imported mime: <code>${payload.outputs.importedMime}</code></div>
        <div>Thumbnail path: <code>${payload.outputs.thumbnailPath}</code></div>
      </div>
    </div>
    <div class="card">
      <h2>Checks</h2>
      <div class="grid">
        <div class="${payload.checks.providerModelLocked ? 'pass' : ''}">Provider lock: ${String(payload.checks.providerModelLocked)}</div>
        <div class="${payload.checks.apiSettingsLocked ? 'pass' : ''}">API settings lock: ${String(payload.checks.apiSettingsLocked)}</div>
        <div class="${payload.checks.importMetadataLocked ? 'pass' : ''}">Import metadata lock: ${String(payload.checks.importMetadataLocked)}</div>
      </div>
    </div>
  </body>
</html>`;

  await fs.writeFile(path.join(reportDir, 'report.html'), html);
  console.log(`Gemini model lock proof written to ${path.join(reportDir, 'report.html')}`);
} finally {
  if (originalHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = originalHome;
  }

  await fs.rm(tempRoot, { recursive: true, force: true });
}
