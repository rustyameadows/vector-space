import { contextBridge, ipcRenderer } from 'electron';

const api = {
  appName: 'Vector Space Library',
  listAssets: () => ipcRenderer.invoke('library:list-assets'),
  listJobs: () => ipcRenderer.invoke('library:list-jobs'),
  listTags: () => ipcRenderer.invoke('library:list-tags'),
  listCollections: () => ipcRenderer.invoke('library:list-collections'),
  importFiles: (paths: string[]) => ipcRenderer.invoke('library:import-files', paths),
  importFolder: (folderPath: string) => ipcRenderer.invoke('library:import-folder', folderPath),
  importClipboard: () => ipcRenderer.invoke('library:import-clipboard'),
  openFileDialog: () => ipcRenderer.invoke('library:open-file-dialog'),
  openFolderDialog: () => ipcRenderer.invoke('library:open-folder-dialog'),
  createCollection: (name: string) => ipcRenderer.invoke('library:create-collection', name),
  createTag: (name: string) => ipcRenderer.invoke('library:create-tag', name),
  attachCollection: (assetId: string, collectionId: string) =>
    ipcRenderer.invoke('library:attach-collection', { assetId, collectionId }),
  attachTag: (assetId: string, tagId: string) =>
    ipcRenderer.invoke('library:attach-tag', { assetId, tagId }),
  pauseIndexing: () => ipcRenderer.invoke('library:pause-indexing'),
  resumeIndexing: () => ipcRenderer.invoke('library:resume-indexing'),
  reindex: () => ipcRenderer.invoke('library:reindex'),
  searchText: (query: string) => ipcRenderer.invoke('library:search-text', query),
  searchImage: (imagePath: string) => ipcRenderer.invoke('library:search-image', imagePath),
  getNetworkState: () => ipcRenderer.invoke('library:network-state'),
  setNetworkState: (online: boolean) => ipcRenderer.invoke('library:set-network-state', online),
  getApiSettings: () => ipcRenderer.invoke('library:get-api-settings'),
  setApiKey: (apiKey: string) => ipcRenderer.invoke('library:set-api-key', apiKey),
  clearApiKey: () => ipcRenderer.invoke('library:clear-api-key')
};

contextBridge.exposeInMainWorld('vectorSpace', api);
