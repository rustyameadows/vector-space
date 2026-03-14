/// <reference types="vite/client" />

import type {
  AppAssetView,
  AssetDetailView,
  SavedSearchPayload,
  SavedSearchView,
  SearchFilters,
  SearchResult
} from '../shared/contracts';

interface VectorSpaceApi {
  appName: string;
  listAssets: () => Promise<AppAssetView[]>;
  getAssetDetail: (assetId: string) => Promise<AssetDetailView | null>;
  listJobs: () => Promise<Array<Record<string, unknown>>>;
  listTags: () => Promise<Array<{ id: string; name: string }>>;
  listCollections: () => Promise<Array<{ id: string; name: string }>>;
  listSavedSearches: () => Promise<SavedSearchView[]>;
  importFiles: (paths: string[]) => Promise<{ imported: number; skipped: number }>;
  importFolder: (folderPath: string) => Promise<{ imported: number; skipped: number }>;
  importClipboard: () => Promise<{ imported: number; skipped: number }>;
  seedDemoData: () => Promise<{ imported: number; skipped: number; outputDir: string }>;
  openFileDialog: () => Promise<string[]>;
  openFolderDialog: () => Promise<string | null>;
  createCollection: (name: string) => Promise<{ id: string }>;
  createTag: (name: string) => Promise<{ id: string }>;
  attachCollection: (assetId: string, collectionId: string) => Promise<{ ok: boolean }>;
  attachTag: (assetId: string, tagId: string) => Promise<{ ok: boolean }>;
  detachCollection: (assetId: string, collectionId: string) => Promise<{ ok: boolean }>;
  detachTag: (assetId: string, tagId: string) => Promise<{ ok: boolean }>;
  batchAssignTags: (assetIds: string[], tagId: string) => Promise<{ ok: boolean }>;
  batchAssignCollections: (assetIds: string[], collectionId: string) => Promise<{ ok: boolean }>;
  batchAcceptSuggestedTags: (assetIds: string[]) => Promise<{ ok: boolean; accepted: number }>;
  updateAssetMetadata: (
    assetId: string,
    payload: { title: string; userNote: string }
  ) => Promise<AssetDetailView | null>;
  rerunEnrichment: (assetIds: string[]) => Promise<{ ok: boolean }>;
  acceptSuggestedTags: (assetId: string, values: string[]) => Promise<AssetDetailView | null>;
  rejectSuggestedTags: (assetId: string, values: string[]) => Promise<AssetDetailView | null>;
  pauseIndexing: () => Promise<{ ok: boolean }>;
  resumeIndexing: () => Promise<{ ok: boolean }>;
  reindex: () => Promise<{ ok: boolean }>;
  retryAssets: (assetIds: string[]) => Promise<{ ok: boolean }>;
  searchText: (query: string, filters?: SearchFilters) => Promise<SearchResult[]>;
  searchImage: (
    imagePath: string,
    text?: string,
    filters?: SearchFilters
  ) => Promise<SearchResult[]>;
  searchSimilarToAsset: (assetId: string, filters?: SearchFilters) => Promise<SearchResult[]>;
  saveSearch: (payload: SavedSearchPayload) => Promise<SavedSearchView>;
  deleteSavedSearch: (savedSearchId: string) => Promise<{ ok: boolean }>;
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
