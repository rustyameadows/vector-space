import { contextBridge, ipcRenderer } from 'electron';
import type { SavedSearchPayload, SearchFilters } from '../shared/contracts';

const api = {
  appName: 'Vector Space Library',
  listAssets: () => ipcRenderer.invoke('library:list-assets'),
  getAssetDetail: (assetId: string) => ipcRenderer.invoke('library:get-asset-detail', assetId),
  listJobs: () => ipcRenderer.invoke('library:list-jobs'),
  listTags: () => ipcRenderer.invoke('library:list-tags'),
  listCollections: () => ipcRenderer.invoke('library:list-collections'),
  listSavedSearches: () => ipcRenderer.invoke('library:list-saved-searches'),
  importFiles: (paths: string[]) => ipcRenderer.invoke('library:import-files', paths),
  importFolder: (folderPath: string) => ipcRenderer.invoke('library:import-folder', folderPath),
  importClipboard: () => ipcRenderer.invoke('library:import-clipboard'),
  seedDemoData: () => ipcRenderer.invoke('library:seed-demo-data'),
  openFileDialog: () => ipcRenderer.invoke('library:open-file-dialog'),
  openFolderDialog: () => ipcRenderer.invoke('library:open-folder-dialog'),
  createCollection: (name: string) => ipcRenderer.invoke('library:create-collection', name),
  createTag: (name: string) => ipcRenderer.invoke('library:create-tag', name),
  attachCollection: (assetId: string, collectionId: string) =>
    ipcRenderer.invoke('library:attach-collection', { assetId, collectionId }),
  attachTag: (assetId: string, tagId: string) =>
    ipcRenderer.invoke('library:attach-tag', { assetId, tagId }),
  detachCollection: (assetId: string, collectionId: string) =>
    ipcRenderer.invoke('library:detach-collection', { assetId, collectionId }),
  detachTag: (assetId: string, tagId: string) =>
    ipcRenderer.invoke('library:detach-tag', { assetId, tagId }),
  batchAssignTags: (assetIds: string[], tagId: string) =>
    ipcRenderer.invoke('library:batch-assign-tags', { assetIds, tagId }),
  batchAssignCollections: (assetIds: string[], collectionId: string) =>
    ipcRenderer.invoke('library:batch-assign-collections', { assetIds, collectionId }),
  batchAcceptSuggestedTags: (assetIds: string[]) =>
    ipcRenderer.invoke('library:batch-accept-suggested-tags', assetIds),
  updateAssetMetadata: (assetId: string, payload: { title: string; userNote: string }) =>
    ipcRenderer.invoke('library:update-asset-metadata', { assetId, ...payload }),
  rerunEnrichment: (assetIds: string[]) => ipcRenderer.invoke('library:rerun-enrichment', assetIds),
  acceptSuggestedTags: (assetId: string, values: string[]) =>
    ipcRenderer.invoke('library:accept-suggested-tags', { assetId, values }),
  rejectSuggestedTags: (assetId: string, values: string[]) =>
    ipcRenderer.invoke('library:reject-suggested-tags', { assetId, values }),
  pauseIndexing: () => ipcRenderer.invoke('library:pause-indexing'),
  resumeIndexing: () => ipcRenderer.invoke('library:resume-indexing'),
  reindex: () => ipcRenderer.invoke('library:reindex'),
  retryAssets: (assetIds: string[]) => ipcRenderer.invoke('library:retry-assets', assetIds),
  searchText: (query: string, filters?: SearchFilters) =>
    ipcRenderer.invoke('library:search-text', { query, filters }),
  searchImage: (imagePath: string, text?: string, filters?: SearchFilters) =>
    ipcRenderer.invoke('library:search-image', { imagePath, text, filters }),
  searchSimilarToAsset: (assetId: string, filters?: SearchFilters) =>
    ipcRenderer.invoke('library:search-similar-to-asset', { assetId, filters }),
  saveSearch: (payload: SavedSearchPayload) => ipcRenderer.invoke('library:save-search', payload),
  deleteSavedSearch: (savedSearchId: string) =>
    ipcRenderer.invoke('library:delete-saved-search', savedSearchId),
  getNetworkState: () => ipcRenderer.invoke('library:network-state'),
  setNetworkState: (online: boolean) => ipcRenderer.invoke('library:set-network-state', online),
  getApiSettings: () => ipcRenderer.invoke('library:get-api-settings'),
  setApiKey: (apiKey: string) => ipcRenderer.invoke('library:set-api-key', apiKey),
  clearApiKey: () => ipcRenderer.invoke('library:clear-api-key')
};

contextBridge.exposeInMainWorld('vectorSpace', api);
