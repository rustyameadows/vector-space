import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(__dirname, '..');
const repoRoot = path.resolve(appDir, '..', '..');
const reportDir = path.join(appDir, 'artifacts', 'import-format-demo');
const fixtureOutputDir = path.join(reportDir, 'fixtures');
const tempHome = path.join(reportDir, 'temp-home');

process.env.HOME = tempHome;

const { ImportService } = await import(path.join(appDir, 'dist/main/services/importService.js'));
const { getImageMetadata } = await import(path.join(appDir, 'dist/main/services/imageProcessing.js'));
const {
  supportedImportEntries,
  materializeImportFixtures
} = await import(path.join(appDir, 'dist/main/test-support/importFixtures.js'));

class CaptureDb {
  constructor() {
    this.inserts = [];
  }

  findAssetByChecksum(checksum) {
    return this.inserts.find((entry) => entry.asset.checksum === checksum)?.asset.id ?? null;
  }

  insertAsset(asset, originalPath, originalSize, thumbPath, metadata) {
    this.inserts.push({ asset, originalPath, originalSize, thumbPath, metadata });
  }
}

await rm(reportDir, { recursive: true, force: true });
await mkdir(fixtureOutputDir, { recursive: true });
await mkdir(tempHome, { recursive: true });

const inputPaths = await materializeImportFixtures(fixtureOutputDir);

const db = new CaptureDb();
const service = new ImportService(db);
const result = await service.importPaths(inputPaths, 'file-picker');

const rows = await Promise.all(
  db.inserts.map(async (entry) => {
    const thumbBytes = await readFile(entry.thumbPath);
    const thumbMetadata = await getImageMetadata(entry.thumbPath);

    return {
      source: path.basename(entry.asset.sourcePath),
      mime: entry.asset.mime,
      width: entry.asset.width,
      height: entry.asset.height,
      originalPath: entry.originalPath,
      thumbnailPath: entry.thumbPath,
      thumbnailWidth: thumbMetadata.width,
      thumbnailHeight: thumbMetadata.height,
      thumbnailDataUrl: `data:image/png;base64,${thumbBytes.toString('base64')}`
    };
  })
);

if (result.imported !== supportedImportEntries.length || result.skipped !== 0) {
  throw new Error(`Unexpected import result: ${JSON.stringify(result)}`);
}

const payload = {
  generatedAt: new Date().toISOString(),
  cwd: repoRoot,
  imported: result.imported,
  skipped: result.skipped,
  rows
};

await writeFile(path.join(reportDir, 'report.json'), `${JSON.stringify(payload, null, 2)}\n`);

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Vector Space Import Format Demo</title>
    <style>
      body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 0; background: #f3f0ea; color: #1b1a18; }
      main { max-width: 1100px; margin: 0 auto; padding: 32px 24px 56px; }
      h1 { margin: 0 0 8px; font-size: 32px; }
      p { margin: 0 0 16px; }
      table { width: 100%; border-collapse: collapse; background: #fffdf8; border: 1px solid #d8d0c2; }
      th, td { padding: 12px; border-bottom: 1px solid #e7dfd2; vertical-align: top; text-align: left; font-size: 14px; }
      th { background: #f7efe1; letter-spacing: 0.04em; text-transform: uppercase; font-size: 12px; }
      img { width: 96px; height: 96px; object-fit: cover; border-radius: 10px; border: 1px solid #d8d0c2; background: #ffffff; }
      code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
      .summary { display: flex; gap: 12px; margin: 20px 0 24px; }
      .pill { background: #1b1a18; color: #fffdf8; border-radius: 999px; padding: 8px 14px; font-size: 13px; }
    </style>
  </head>
  <body>
    <main>
      <h1>Vector Space Import Format Demo</h1>
      <p>Generated from the actual desktop import service against real image files for every claimed format.</p>
      <div class="summary">
        <div class="pill">Imported: ${payload.imported}</div>
        <div class="pill">Skipped: ${payload.skipped}</div>
        <div class="pill">Formats: ${rows.map((row) => row.mime).join(', ')}</div>
      </div>
      <table>
        <thead>
          <tr>
            <th>Thumbnail</th>
            <th>Source</th>
            <th>MIME</th>
            <th>Original</th>
            <th>Thumbnail Output</th>
          </tr>
        </thead>
        <tbody>
          ${rows
            .map(
              (row) => `<tr>
            <td><img src="${row.thumbnailDataUrl}" alt="${row.source}" /></td>
            <td><strong>${row.source}</strong><br /><code>${row.width}x${row.height}</code></td>
            <td><code>${row.mime}</code></td>
            <td><code>${row.originalPath}</code></td>
            <td><code>${row.thumbnailPath}</code><br /><code>${row.thumbnailWidth}x${row.thumbnailHeight} PNG</code></td>
          </tr>`
            )
            .join('')}
        </tbody>
      </table>
    </main>
  </body>
</html>`;

await writeFile(path.join(reportDir, 'report.html'), html);

console.log(`Import report written to ${path.join(reportDir, 'report.html')}`);
console.log(`Import JSON written to ${path.join(reportDir, 'report.json')}`);
