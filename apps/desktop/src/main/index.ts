import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  nativeImage,
  net,
  protocol
} from 'electron';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { getLibraryPaths, initializeLibraryPathing, LibraryPathError } from './library/pathManager';
import { VectorSpaceDb } from './db/database';
import { ImportService } from './services/importService';
import { SUPPORTED_IMAGE_EXTENSIONS } from './services/imageProcessing';
import { GeminiEmbeddingProvider, type EmbeddingProvider } from './embedding/provider';
import {
  deleteGeminiApiKeyFromKeychain,
  getGeminiApiKeyFromKeychain,
  setGeminiApiKeyInKeychain
} from './embedding/keychain';
import {
  GEMINI_EMBEDDING_MODEL,
  GEMINI_EXTRACTION_VERSION,
  GEMINI_OCR_VERSION,
  GEMINI_OUTPUT_DIMENSIONALITY,
  GEMINI_PREPROCESSING_VERSION,
  getGeminiApiSettings
} from '../shared/gemini';
import { IndexingService } from './services/indexingService';
import { HybridSearchService } from './search/hybridSearch';
import { ThumbnailMaintenanceService } from './services/thumbnailMaintenance';
import { LocalAssetEnrichmentService } from './services/assetEnrichment';
import type { IndexJobView, SearchMode } from './types/domain';
import type { SavedSearchPayload, SearchFilters } from '../shared/contracts';

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);
const rendererDistPath = path.join(__dirname, '../renderer');

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true
    }
  }
]);

let db: VectorSpaceDb;
let importService: ImportService;
let indexingService: IndexingService;
let searchService: HybridSearchService;
let thumbnailMaintenanceService: ThumbnailMaintenanceService;
let embeddingProvider: EmbeddingProvider | null = null;
let online = true;
const isKeychainDisabled = process.env.VECTOR_SPACE_DISABLE_KEYCHAIN === '1';

const requireNonEmptyName = (value: string, label: string): string => {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${label} cannot be empty.`);
  }

  return normalized;
};

const registerAppProtocol = (): void => {
  protocol.handle('app', (request) => {
    const url = new URL(request.url);
    if (url.host !== 'renderer') {
      return new Response('Not found', { status: 404 });
    }

    if (url.pathname === '/library-asset') {
      const requestedPath = url.searchParams.get('path');
      if (!requestedPath) {
        return new Response('Missing asset path', { status: 400 });
      }

      const libraryRoot = path.resolve(getLibraryPaths().root);
      const assetPath = path.resolve(requestedPath);
      const allowedPrefix = `${libraryRoot}${path.sep}`;

      if (assetPath !== libraryRoot && !assetPath.startsWith(allowedPrefix)) {
        return new Response('Forbidden', { status: 403 });
      }

      return net.fetch(pathToFileURL(assetPath).toString());
    }

    const requestPath = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    const filePath = path.resolve(rendererDistPath, `.${requestPath}`);

    if (!filePath.startsWith(rendererDistPath)) {
      return new Response('Not found', { status: 404 });
    }

    return net.fetch(pathToFileURL(filePath).toString());
  });
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

  window.loadURL('app://renderer/index.html').catch((error: unknown) => {
    console.error('Failed to load renderer URL', error);
  });
};

const createProviderFromKeychain = async (): Promise<EmbeddingProvider | null> => {
  if (isKeychainDisabled) {
    return null;
  }

  const apiKey = await getGeminiApiKeyFromKeychain();
  if (!apiKey) {
    return null;
  }

  return new GeminiEmbeddingProvider({ apiKey });
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

const maybeReindexAssets = (assetIds: string[]): void => {
  if (!online || !embeddingProvider || assetIds.length === 0) {
    return;
  }

  indexingService.retryAssets(assetIds);
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
  filters?: SearchFilters;
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
    filters: {
      onlyOfflineReady: true,
      ...(params.filters ?? {})
    }
  });
};

const listJobs = (): IndexJobView[] => {
  const mergedJobs = new Map<string, IndexJobView>();

  db.listIndexJobs().forEach((job) => {
    mergedJobs.set(`${job.assetId}:${job.stage}`, job);
  });

  indexingService.getLiveJobs().forEach((job) => {
    mergedJobs.set(`${job.assetId}:${job.stage}`, job);
  });

  return Array.from(mergedJobs.values()).sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt)
  );
};

const registerIpc = (): void => {
  ipcMain.handle('library:list-assets', () => db.listAssets());
  ipcMain.handle('library:get-asset-detail', (_event, assetId: string) => db.getAssetById(assetId));
  ipcMain.handle('library:list-jobs', () => listJobs());
  ipcMain.handle('library:list-tags', () => db.listTags());
  ipcMain.handle('library:list-collections', () => db.listCollections());
  ipcMain.handle('library:list-saved-searches', () => db.listSavedSearches());
  ipcMain.handle('library:network-state', () => ({ online }));

  ipcMain.handle('library:get-api-settings', () =>
    getGeminiApiSettings(Boolean(embeddingProvider))
  );

  ipcMain.handle('library:set-api-key', async (_event, apiKey: string) => {
    if (isKeychainDisabled) {
      throw new Error('Gemini API key storage is disabled for this session.');
    }

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
    if (isKeychainDisabled) {
      return { hasApiKey: false };
    }

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
        {
          name: 'Images',
          extensions: SUPPORTED_IMAGE_EXTENSIONS.map((extension) => extension.slice(1))
        }
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
      maybeReindexAssets([payload.assetId]);
      return { ok: true };
    }
  );

  ipcMain.handle('library:attach-tag', (_event, payload: { assetId: string; tagId: string }) => {
    db.attachTagToAsset(payload.assetId, payload.tagId);
    maybeReindexAssets([payload.assetId]);
    return { ok: true };
  });

  ipcMain.handle(
    'library:detach-collection',
    (_event, payload: { assetId: string; collectionId: string }) => {
      db.detachAssetFromCollection(payload.assetId, payload.collectionId);
      maybeReindexAssets([payload.assetId]);
      return { ok: true };
    }
  );

  ipcMain.handle('library:detach-tag', (_event, payload: { assetId: string; tagId: string }) => {
    db.detachTagFromAsset(payload.assetId, payload.tagId);
    maybeReindexAssets([payload.assetId]);
    return { ok: true };
  });

  ipcMain.handle(
    'library:batch-assign-tags',
    (_event, payload: { assetIds: string[]; tagId: string }) => {
      db.attachTagToAssets(payload.assetIds, payload.tagId);
      maybeReindexAssets(payload.assetIds);
      return { ok: true };
    }
  );

  ipcMain.handle(
    'library:batch-assign-collections',
    (_event, payload: { assetIds: string[]; collectionId: string }) => {
      db.attachAssetsToCollection(payload.assetIds, payload.collectionId);
      maybeReindexAssets(payload.assetIds);
      return { ok: true };
    }
  );

  ipcMain.handle(
    'library:update-asset-metadata',
    (_event, payload: { assetId: string; title: string; userNote: string }) => {
      db.updateAssetMetadata(payload.assetId, {
        title: payload.title,
        userNote: payload.userNote
      });
      maybeReindexAssets([payload.assetId]);
      return db.getAssetById(payload.assetId);
    }
  );

  ipcMain.handle('library:save-search', (_event, payload: SavedSearchPayload) => {
    const normalizedName = requireNonEmptyName(payload.name, 'Saved search name');
    return db.saveSearch({
      ...payload,
      name: normalizedName
    });
  });

  ipcMain.handle('library:delete-saved-search', (_event, savedSearchId: string) => {
    db.deleteSavedSearch(savedSearchId);
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

  ipcMain.handle('library:retry-assets', async (_event, assetIds: string[]) => {
    indexingService.retryAssets(assetIds);
    return { ok: true };
  });

  ipcMain.handle(
    'library:search-text',
    async (
      _event,
      payload:
        | string
        | {
            query: string;
            filters?: SearchFilters;
          }
    ) => {
      if (typeof payload === 'string') {
        return runSearch({ text: payload, mode: 'exploration' });
      }

      return runSearch({
        text: payload.query,
        mode: 'exploration',
        filters: payload.filters
      });
    }
  );

  ipcMain.handle(
    'library:search-image',
    async (
      _event,
      payload:
        | string
        | {
            imagePath: string;
            text?: string;
            filters?: SearchFilters;
          }
    ) => {
      if (typeof payload === 'string') {
        return runSearch({ imagePath: payload, mode: 'similarity' });
      }

      return runSearch({
        imagePath: payload.imagePath,
        text: payload.text,
        mode: 'similarity',
        filters: payload.filters
      });
    }
  );
};

app.whenReady().then(async () => {
  try {
    registerAppProtocol();
    const libraryPaths = await initializeLibraryPathing();
    db = new VectorSpaceDb(libraryPaths.db);
    db.recoverInterruptedIndexJobs();
    importService = new ImportService(db);
    embeddingProvider = await createProviderFromKeychain();

    indexingService = new IndexingService(
      db,
      {
        name: 'gemini',
        model: GEMINI_EMBEDDING_MODEL,
        preprocessingVersion: GEMINI_PREPROCESSING_VERSION,
        extractionVersion: GEMINI_EXTRACTION_VERSION,
        ocrVersion: GEMINI_OCR_VERSION,
        outputDimensionality: GEMINI_OUTPUT_DIMENSIONALITY,
        embed: async (request) => requireEmbeddingProvider().embed(request)
      },
      new LocalAssetEnrichmentService()
    );
    searchService = new HybridSearchService(db);
    thumbnailMaintenanceService = new ThumbnailMaintenanceService(db);
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
  void thumbnailMaintenanceService.repairGridThumbnails().catch((error: unknown) => {
    console.error('Failed to repair grid thumbnails during startup', error);
  });

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
