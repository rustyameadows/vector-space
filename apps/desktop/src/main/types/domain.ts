export type AssetStatus = 'imported' | 'indexing' | 'ready' | 'failed';

export type EmbeddingRole = 'joint' | 'visual' | 'text' | 'chunk';

export type SearchMode = 'similarity' | 'exploration';

export type IndexJobStatus = 'queued' | 'running' | 'success' | 'failed';

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
  collectionName?: string;
  tagNames?: string[];
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
  thumbnailUpdatedAt: string | null;
  originalPath: string;
  tags: string[];
  collections: string[];
  retrievalCaption: string;
}

export interface IndexJobView {
  assetId: string;
  stage: string;
  status: IndexJobStatus;
  error: string | null;
  updatedAt: string;
}

export interface EmbeddingRecord {
  assetId: string;
  role: EmbeddingRole;
  vector: number[];
  taskType: 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY';
  model: string;
  dimension: number;
  preprocessingVersion: number;
  extractionVersion: number;
  ocrVersion: number;
}
