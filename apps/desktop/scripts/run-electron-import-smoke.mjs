import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(__dirname, '..');
const repoRoot = path.resolve(appDir, '..', '..');
const outputDir = path.join(repoRoot, 'output', 'playwright', 'import-ui-smoke');
const fixtureOutputDir = path.join(outputDir, 'fixtures');
const libraryRoot = path.join(outputDir, 'library');
const reportPath = path.join(outputDir, 'report.json');
const htmlPath = path.join(outputDir, 'report.html');
const screenshotPath = path.join(outputDir, 'electron-import-grid.png');

const { _electron: electron } = await import('playwright');
const {
  supportedImportEntries,
  materializeImportFixtures
} = await import(path.join(appDir, 'dist/main/test-support/importFixtures.js'));

await rm(outputDir, { recursive: true, force: true });
await mkdir(fixtureOutputDir, { recursive: true });
await mkdir(libraryRoot, { recursive: true });

const inputPaths = await materializeImportFixtures(fixtureOutputDir);

process.env.VECTOR_SPACE_LIBRARY_ROOT = libraryRoot;
process.env.VECTOR_SPACE_DISABLE_KEYCHAIN = '1';

const electronApp = await electron.launch({
  args: [appDir]
});

try {
  const appWindow = await electronApp.firstWindow();
  await appWindow.waitForLoadState('domcontentloaded');
  await appWindow.getByText('Your library').waitFor({ timeout: 20_000 });

  const result = await appWindow.evaluate(async ({ filePaths }) => {
    return window.vectorSpace.importFiles(filePaths);
  }, { filePaths: inputPaths });

  if (result.imported !== supportedImportEntries.length || result.skipped !== 0) {
    throw new Error(`Unexpected import result: ${JSON.stringify(result)}`);
  }

  await appWindow.waitForFunction(
    (expected) => document.querySelectorAll('.card').length === expected,
    supportedImportEntries.length,
    { timeout: 20_000 }
  );

  await appWindow.waitForFunction(
    (expected) => {
      const images = Array.from(document.querySelectorAll('.card img'));
      return (
        images.length === expected &&
        images.every((image) => image.complete && image.naturalWidth > 0 && image.naturalHeight > 0)
      );
    },
    supportedImportEntries.length,
    { timeout: 20_000 }
  );

  const uiState = await appWindow.evaluate(async () => {
    const assets = await window.vectorSpace.listAssets();
    const cards = Array.from(document.querySelectorAll('.card')).map((card) => {
      const name = card.querySelector('.asset-name')?.textContent ?? '';
      const image = card.querySelector('img');
      return {
        name,
        src: image?.getAttribute('src') ?? null,
        complete: image?.complete ?? false,
        naturalWidth: image?.naturalWidth ?? 0,
        naturalHeight: image?.naturalHeight ?? 0
      };
    });

    return {
      assets,
      cards,
      message: document.querySelector('.message-pill')?.textContent?.trim() ?? ''
    };
  });

  await appWindow.screenshot({ path: screenshotPath });

  const cardMap = new Map(uiState.cards.map((card) => [card.name, card]));
  const rows = await Promise.all(
    uiState.assets.map(async (asset) => {
      const thumbBytes = await readFile(asset.thumbnailPath);
      const cardName = path.basename(asset.originalPath).toUpperCase();
      const card = cardMap.get(cardName) ?? null;

      return {
        cardName,
        id: asset.id,
        mime: asset.mime,
        originalPath: asset.originalPath,
        thumbnailPath: asset.thumbnailPath,
        uiImageSrc: card?.src ?? null,
        uiImageComplete: card?.complete ?? false,
        uiNaturalWidth: card?.naturalWidth ?? 0,
        uiNaturalHeight: card?.naturalHeight ?? 0,
        thumbnailDataUrl: `data:image/png;base64,${thumbBytes.toString('base64')}`
      };
    })
  );

  const rowCount = rows.length;
  const uiLoadedCount = rows.filter((row) => row.uiImageComplete && row.uiNaturalWidth > 0).length;

  if (rowCount !== supportedImportEntries.length) {
    throw new Error(`Expected ${supportedImportEntries.length} assets in the UI, found ${rowCount}.`);
  }

  if (uiLoadedCount !== supportedImportEntries.length) {
    throw new Error(
      `Expected ${supportedImportEntries.length} loaded thumbnails in the UI, found ${uiLoadedCount}.`
    );
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    imported: result.imported,
    skipped: result.skipped,
    uiMessage: uiState.message,
    screenshotPath,
    rows: rows.map((row) => ({
      cardName: row.cardName,
      id: row.id,
      mime: row.mime,
      originalPath: row.originalPath,
      thumbnailPath: row.thumbnailPath,
      uiImageSrc: row.uiImageSrc,
      uiImageComplete: row.uiImageComplete,
      uiNaturalWidth: row.uiNaturalWidth,
      uiNaturalHeight: row.uiNaturalHeight
    }))
  };

  await writeFile(reportPath, `${JSON.stringify(payload, null, 2)}\n`);

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Vector Space Electron Import Smoke</title>
    <style>
      body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 0; background: #f4efe4; color: #201d18; }
      main { max-width: 1180px; margin: 0 auto; padding: 32px 24px 56px; }
      h1 { margin: 0 0 8px; font-size: 32px; }
      p { margin: 0 0 16px; }
      .summary { display: flex; gap: 12px; margin: 20px 0 24px; flex-wrap: wrap; }
      .pill { background: #201d18; color: #fffaf3; border-radius: 999px; padding: 8px 14px; font-size: 13px; }
      .shot { width: 100%; border-radius: 16px; border: 1px solid #d4c7b2; margin-bottom: 24px; }
      table { width: 100%; border-collapse: collapse; background: #fffdf8; border: 1px solid #d8d0c2; }
      th, td { padding: 12px; border-bottom: 1px solid #e7dfd2; vertical-align: top; text-align: left; font-size: 14px; }
      th { background: #f7efe1; letter-spacing: 0.04em; text-transform: uppercase; font-size: 12px; }
      img.thumb { width: 96px; height: 96px; object-fit: cover; border-radius: 10px; border: 1px solid #d8d0c2; background: #ffffff; }
      code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
    </style>
  </head>
  <body>
    <main>
      <h1>Vector Space Electron Import Smoke</h1>
      <p>Real Electron app run using the preload import API. Each supported image extension was uploaded and the renderer thumbnails were required to load successfully.</p>
      <div class="summary">
        <div class="pill">Imported: ${payload.imported}</div>
        <div class="pill">Skipped: ${payload.skipped}</div>
        <div class="pill">Loaded UI thumbs: ${uiLoadedCount}/${supportedImportEntries.length}</div>
        <div class="pill">Message: ${payload.uiMessage}</div>
      </div>
      <img class="shot" src="${path.basename(screenshotPath)}" alt="Electron import grid" />
      <table>
        <thead>
          <tr>
            <th>Thumbnail</th>
            <th>Asset</th>
            <th>MIME</th>
            <th>UI Load</th>
            <th>Stored Paths</th>
          </tr>
        </thead>
        <tbody>
          ${rows
            .map(
              (row) => `<tr>
            <td><img class="thumb" src="${row.thumbnailDataUrl}" alt="${row.cardName}" /></td>
            <td><strong>${row.cardName}</strong><br /><code>${row.id}</code></td>
            <td><code>${row.mime}</code></td>
            <td><code>complete=${row.uiImageComplete}</code><br /><code>${row.uiNaturalWidth}x${row.uiNaturalHeight}</code></td>
            <td><code>${row.originalPath}</code><br /><code>${row.thumbnailPath}</code></td>
          </tr>`
            )
            .join('')}
        </tbody>
      </table>
    </main>
  </body>
</html>`;

  await writeFile(htmlPath, html);

  console.log(`Electron import smoke screenshot: ${screenshotPath}`);
  console.log(`Electron import smoke report: ${htmlPath}`);
  console.log(`Electron import smoke JSON: ${reportPath}`);
} finally {
  await electronApp.close().catch(() => {});
}
