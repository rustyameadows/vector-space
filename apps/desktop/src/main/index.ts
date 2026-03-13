import { app, BrowserWindow, clipboard, dialog, ipcMain } from 'electron';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { initializeLibraryPathing, LibraryPathError } from './library/pathManager';
import { VectorSpaceDb } from './db/database';
import { ImportService } from './services/importService';
import { GeminiEmbeddingProvider, type EmbeddingProvider } from './embedding/provider';
import { deleteGeminiApiKeyFromKeychain, getGeminiApiKeyFromKeychain, setGeminiApiKeyInKeychain } from './embedding/keychain';
import { IndexingService } from './services/indexingService';
import { HybridSearchService } from './search/hybridSearch';

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);

let db: VectorSpaceDb;
let importService: ImportService;
let indexingService: IndexingService;
let searchService: HybridSearchService;
let embeddingProvider: EmbeddingProvider | null = null;
let online = true;

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
    throw new Error('Gemini API key is not configured. Add it in Settings to enable indexing and semantic search.');
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

const registerIpc = (): void => {
  ipcMain.handle('library:list-assets', () => db.listAssets());
  ipcMain.handle('library:list-jobs', () => db.listIndexJobs());
  ipcMain.handle('library:list-tags', () => db.listTags());
  ipcMain.handle('library:list-collections', () => db.listCollections());
  ipcMain.handle('library:network-state', () => ({ online }));

  ipcMain.handle('library:get-api-settings', () => ({ hasApiKey: Boolean(embeddingProvider), model: 'gemini-embedding-001' }));

  ipcMain.handle('library:set-api-key', async (_event, apiKey: string) => {
    await setGeminiApiKeyInKeychain(apiKey);
    embeddingProvider = await createProviderFromKeychain();
    return { hasApiKey: Boolean(embeddingProvider) };
  });

  ipcMain.handle('library:clear-api-key', async () => {
    await deleteGeminiApiKeyFromKeychain();
    embeddingProvider = null;
    return { hasApiKey: false };
  });

  ipcMain.handle('library:set-network-state', (_event, value: boolean) => {
    online = value;
    return { online };
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
    const response = await dialog.showOpenDialog({ properties: ['openFile', 'multiSelections'] });
    return response.filePaths;
  });

  ipcMain.handle('library:open-folder-dialog', async () => {
    const response = await dialog.showOpenDialog({ properties: ['openDirectory'] });
    return response.filePaths[0] ?? null;
  });

  ipcMain.handle('library:create-collection', (_event, name: string) => ({
    id: db.ensureCollection(name)
  }));
  ipcMain.handle('library:create-tag', (_event, name: string) => ({ id: db.ensureTag(name) }));

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
    const vector = await requireEmbeddingProvider().embedText(query);
    return searchService.searchByVector(vector, { onlyOfflineReady: true });
  });

  ipcMain.handle('library:search-image', async (_event, imagePath: string) => {
    const file = await fs.readFile(imagePath);
    const vector = await requireEmbeddingProvider().embedImage(file);
    return searchService.searchByVector(vector, { onlyOfflineReady: true });
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
      version: 'v1',
      embedText: async (input: string) => requireEmbeddingProvider().embedText(input),
      embedImage: async (buffer: Buffer) => requireEmbeddingProvider().embedImage(buffer)
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
