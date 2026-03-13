export type AssetStatus = 'imported' | 'indexing' | 'ready' | 'failed';

export interface AssetRecord {
  id: string;
  createdAt: string;
  importSource: 'drag-drop' | 'file-picker' | 'folder' | 'clipboard';
  mime: string;
  width: number;
  height: number;
  checksum: string;
  status: AssetStatus;
  sourcePath: string;
}

export interface SearchFilters {
  mimePrefix?: string;
  collectionId?: string;
  tagIds?: string[];
  onlyOfflineReady?: boolean;
}

export interface SearchResult {
  assetId: string;
  score: number;
  reasons: string[];
}

export interface AppAssetView {
  id: string;
  createdAt: string;
  mime: string;
  width: number;
  height: number;
  status: AssetStatus;
  thumbnailPath: string | null;
  originalPath: string;
  tags: string[];
  collections: string[];
}
