/// <reference types="vite/client" />

interface VectorSpaceApi {
  appName: string;
  listAssets: () => Promise<Array<Record<string, unknown>>>;
  listJobs: () => Promise<Array<Record<string, unknown>>>;
  listTags: () => Promise<Array<{ id: string; name: string }>>;
  listCollections: () => Promise<Array<{ id: string; name: string }>>;
  importFiles: (paths: string[]) => Promise<{ imported: number; skipped: number }>;
  importFolder: (folderPath: string) => Promise<{ imported: number; skipped: number }>;
  importClipboard: () => Promise<{ imported: number; skipped: number }>;
  openFileDialog: () => Promise<string[]>;
  openFolderDialog: () => Promise<string | null>;
  createCollection: (name: string) => Promise<{ id: string }>;
  createTag: (name: string) => Promise<{ id: string }>;
  attachCollection: (assetId: string, collectionId: string) => Promise<{ ok: boolean }>;
  attachTag: (assetId: string, tagId: string) => Promise<{ ok: boolean }>;
  pauseIndexing: () => Promise<{ ok: boolean }>;
  resumeIndexing: () => Promise<{ ok: boolean }>;
  reindex: () => Promise<{ ok: boolean }>;
  searchText: (
    query: string
  ) => Promise<Array<{ assetId: string; score: number; reasons: string[] }>>;
  searchImage: (
    imagePath: string
  ) => Promise<Array<{ assetId: string; score: number; reasons: string[] }>>;
  getNetworkState: () => Promise<{ online: boolean }>;
  setNetworkState: (online: boolean) => Promise<{ online: boolean }>;
  getApiSettings: () => Promise<{ hasApiKey: boolean; model: string }>;
  setApiKey: (apiKey: string) => Promise<{ hasApiKey: boolean }>;
  clearApiKey: () => Promise<{ hasApiKey: boolean }>;
}

declare global {
  interface Window {
    vectorSpace: VectorSpaceApi;
  }
}

export {};
