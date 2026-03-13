import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeImage } from 'electron';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { initializeLibraryPathing, LibraryPathError } from './library/pathManager';
import { VectorSpaceDb } from './db/database';
import { ImportService } from './services/importService';
import { GeminiEmbeddingProvider, type EmbeddingProvider } from './embedding/provider';
import {
  deleteGeminiApiKeyFromKeychain,
  getGeminiApiKeyFromKeychain,
  setGeminiApiKeyInKeychain
} from './embedding/keychain';
import { IndexingService } from './services/indexingService';
import { HybridSearchService } from './search/hybridSearch';
import type { SearchMode } from './types/domain';

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);

let db: VectorSpaceDb;
let importService: ImportService;
let indexingService: IndexingService;
let searchService: HybridSearchService;
let embeddingProvider: EmbeddingProvider | null = null;
let online = true;

const requireNonEmptyName = (value: string, label: string): string => {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${label} cannot be empty.`);
  }

  return normalized;
};

const createWindow = (): void => {
  const window = new BrowserWindow({
    width: 1320,
    height: 860,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  const rendererUrl = process.env.VITE_DEV_SERVER_URL;
  if (rendererUrl) {
    window.loadURL(rendererUrl).catch((error: unknown) => {
      console.error('Failed to load renderer URL', error);
    });
    if (isDev) {
      window.webContents.openDevTools({ mode: 'detach' });
    }
    return;
  }

  window.loadFile(path.join(__dirname, '../renderer/index.html')).catch((error: unknown) => {
    console.error('Failed to load renderer file', error);
  });
};

const createProviderFromKeychain = async (): Promise<EmbeddingProvider | null> => {
  const apiKey = await getGeminiApiKeyFromKeychain();
  if (!apiKey) {
    return null;
  }

  return new GeminiEmbeddingProvider({ apiKey, model: 'gemini-embedding-001' });
};

const requireEmbeddingProvider = (): EmbeddingProvider => {
  if (!embeddingProvider) {
    throw new Error(
      'Gemini API key is not configured. Add it in Settings to enable indexing and semantic search.'
    );
  }

  return embeddingProvider;
};

const showStartupErrorAndExit = async (message: string): Promise<void> => {
  await dialog.showMessageBox({
    type: 'error',
    title: 'Vector Space',
    message: 'Unable to initialize local library',
    detail: message
  });

  app.quit();
};

const getImportedAssetIds = (): string[] =>
  db
    .listAssets()
    .filter((asset) => asset.status === 'imported')
    .map((asset) => asset.id);

const enqueueImportedAssets = (assetIds: string[]): void => {
  if (!online || !embeddingProvider || assetIds.length === 0) {
    return;
  }

  indexingService.enqueue(assetIds);
};

const enqueueAllImportedAssets = (): void => {
  enqueueImportedAssets(getImportedAssetIds());
};

const importAndMaybeEnqueue = async (
  inputPaths: string[],
  source: 'file-picker' | 'folder' | 'clipboard'
): Promise<{ imported: number; skipped: number }> => {
  const importedBefore = new Set(getImportedAssetIds());
  const result = await importService.importPaths(inputPaths, source);
  const newlyImported = getImportedAssetIds().filter((assetId) => !importedBefore.has(assetId));
  enqueueImportedAssets(newlyImported);
  return result;
};

const createSeedImagePng = (
  label: string,
  width: number,
  height: number,
  color: string
): Buffer => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="${color}"/><text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle" fill="#ffffff" font-size="28" font-family="Inter,Arial,sans-serif">${label}</text></svg>`;
  const dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  return nativeImage.createFromDataURL(dataUrl).toPNG();
};

const seedDemoData = async (): Promise<{
  imported: number;
  skipped: number;
  outputDir: string;
}> => {
  const outputDir = path.join(app.getPath('temp'), 'vector-space-demo-seed');
  await fs.mkdir(outputDir, { recursive: true });

  const palettes = [
    '#ef4444',
    '#f97316',
    '#eab308',
    '#84cc16',
    '#22c55e',
    '#14b8a6',
    '#06b6d4',
    '#3b82f6',
    '#6366f1',
    '#8b5cf6',
    '#d946ef',
    '#ec4899'
  ];
  const labels = [
    'Coral',
    'Amber',
    'Lime',
    'Emerald',
    'Teal',
    'Cyan',
    'Sky',
    'Indigo',
    'Violet',
    'Magenta'
  ];
  const dimensions = [
    [1024, 1024],
    [1280, 720],
    [1440, 900],
    [1080, 1080],
    [1200, 800],
    [800, 1200]
  ] as const;

  const specs = Array.from({ length: 60 }, (_, index) => {
    const [width, height] = dimensions[index % dimensions.length];
    const color = palettes[index % palettes.length];
    const label = `${labels[index % labels.length]} ${String(index + 1).padStart(2, '0')}`;

    return { label, width, height, color };
  });

  const paths = await Promise.all(
    specs.map(async (spec, index) => {
      const filePath = path.join(
        outputDir,
        `demo-${index + 1}-${spec.label.toLowerCase().replace(/\s+/g, '-')}.png`
      );
      await fs.writeFile(
        filePath,
        createSeedImagePng(spec.label, spec.width, spec.height, spec.color)
      );
      return filePath;
    })
  );

  const result = await importAndMaybeEnqueue(paths, 'folder');
  return { ...result, outputDir };
};

const runSearch = async (params: {
  mode: SearchMode;
  text?: string;
  imagePath?: string;
}): Promise<ReturnType<HybridSearchService['search']>> => {
  const provider = requireEmbeddingProvider();
  const vectors: Parameters<HybridSearchService['search']>[0]['vectors'] = {};

  const normalizedText = params.text?.trim();
  if (normalizedText) {
    vectors.text = await provider.embed({
      taskType: 'RETRIEVAL_QUERY',
      textParts: [normalizedText]
    });
  }

  if (params.imagePath) {
    const file = await fs.readFile(params.imagePath);
    vectors.visual = await provider.embed({ taskType: 'RETRIEVAL_QUERY', imageBuffer: file });

    if (normalizedText) {
      vectors.joint = await provider.embed({
        taskType: 'RETRIEVAL_QUERY',
        imageBuffer: file,
        textParts: [normalizedText]
      });
    }
  } else if (normalizedText) {
    vectors.joint = await provider.embed({
      taskType: 'RETRIEVAL_QUERY',
      textParts: [normalizedText]
    });
  }

  return searchService.search({
    mode: params.mode,
    text: normalizedText,
    vectors,
    filters: { onlyOfflineReady: true }
  });
};

const registerIpc = (): void => {
  ipcMain.handle('library:list-assets', () => db.listAssets());
  ipcMain.handle('library:list-jobs', () => db.listIndexJobs());
  ipcMain.handle('library:list-tags', () => db.listTags());
  ipcMain.handle('library:list-collections', () => db.listCollections());
  ipcMain.handle('library:network-state', () => ({ online }));

  ipcMain.handle('library:get-api-settings', () => ({
    hasApiKey: Boolean(embeddingProvider),
    model: 'gemini-embedding-001'
  }));

  ipcMain.handle('library:set-api-key', async (_event, apiKey: string) => {
    const normalizedApiKey = apiKey.trim();
    if (!normalizedApiKey) {
      throw new Error('API key cannot be empty.');
    }

    await setGeminiApiKeyInKeychain(normalizedApiKey);
    embeddingProvider = await createProviderFromKeychain();
    enqueueAllImportedAssets();
    return { hasApiKey: Boolean(embeddingProvider) };
  });

  ipcMain.handle('library:clear-api-key', async () => {
    await deleteGeminiApiKeyFromKeychain();
    embeddingProvider = null;
    return { hasApiKey: false };
  });

  ipcMain.handle('library:set-network-state', (_event, value: boolean) => {
    const wasOffline = !online;
    online = value;

    if (wasOffline && online) {
      enqueueAllImportedAssets();
    }

    return { online };
  });

  ipcMain.handle('library:seed-demo-data', async () => {
    return seedDemoData();
  });

  ipcMain.handle('library:import-files', async (_event, filePaths: string[]) => {
    return importAndMaybeEnqueue(filePaths, 'file-picker');
  });

  ipcMain.handle('library:import-folder', async (_event, folderPath: string) => {
    const imagePaths = await importService.collectFolderImages(folderPath);
    return importAndMaybeEnqueue(imagePaths, 'folder');
  });

  ipcMain.handle('library:import-clipboard', async () => {
    const image = clipboard.readImage();
    if (image.isEmpty()) {
      return { imported: 0, skipped: 1 };
    }

    const tempPath = path.join(app.getPath('temp'), `vs-clip-${Date.now()}.png`);
    await fs.writeFile(tempPath, image.toPNG());
    return importAndMaybeEnqueue([tempPath], 'clipboard');
  });

  ipcMain.handle('library:open-file-dialog', async () => {
    const response = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tiff'] }
      ]
    });
    return response.filePaths;
  });

  ipcMain.handle('library:open-folder-dialog', async () => {
    const response = await dialog.showOpenDialog({ properties: ['openDirectory'] });
    return response.filePaths[0] ?? null;
  });

  ipcMain.handle('library:create-collection', (_event, name: string) => ({
    id: db.ensureCollection(requireNonEmptyName(name, 'Collection name'))
  }));
  ipcMain.handle('library:create-tag', (_event, name: string) => ({
    id: db.ensureTag(requireNonEmptyName(name, 'Tag name'))
  }));

  ipcMain.handle(
    'library:attach-collection',
    (_event, payload: { assetId: string; collectionId: string }) => {
      db.attachAssetToCollection(payload.assetId, payload.collectionId);
      return { ok: true };
    }
  );

  ipcMain.handle('library:attach-tag', (_event, payload: { assetId: string; tagId: string }) => {
    db.attachTagToAsset(payload.assetId, payload.tagId);
    return { ok: true };
  });

  ipcMain.handle('library:pause-indexing', () => {
    indexingService.pause();
    return { ok: true };
  });

  ipcMain.handle('library:resume-indexing', () => {
    indexingService.resume();
    return { ok: true };
  });

  ipcMain.handle('library:reindex', async () => {
    await indexingService.reindexAll();
    return { ok: true };
  });

  ipcMain.handle('library:search-text', async (_event, query: string) => {
    return runSearch({ text: query, mode: 'exploration' });
  });

  ipcMain.handle('library:search-image', async (_event, imagePath: string) => {
    return runSearch({ imagePath, mode: 'similarity' });
  });
};

app.whenReady().then(async () => {
  try {
    const libraryPaths = await initializeLibraryPathing();
    db = new VectorSpaceDb(libraryPaths.db);
    importService = new ImportService(db);
    embeddingProvider = await createProviderFromKeychain();

    indexingService = new IndexingService(db, {
      name: 'gemini',
      model: 'gemini-embedding-001',
      preprocessingVersion: 3,
      extractionVersion: 2,
      ocrVersion: 2,
      outputDimensionality: 3072,
      embed: async (request) => requireEmbeddingProvider().embed(request)
    });
    searchService = new HybridSearchService(db);
    registerIpc();
  } catch (error: unknown) {
    if (error instanceof LibraryPathError) {
      await showStartupErrorAndExit(error.userMessage);
      return;
    }

    console.error('Unexpected startup error while initializing library paths', error);
    await showStartupErrorAndExit(
      'Vector Space could not initialize local storage. Please restart the app and try again.'
    );
    return;
  }

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
