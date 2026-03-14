import type {
  AppAssetView,
  AssetDetailView,
  AssetEnrichmentView,
  AssetStatus,
  SavedSearchPayload,
  SavedSearchView,
  SearchFilters,
  SearchResult
} from '../../shared/contracts';

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

export type {
  AppAssetView,
  AssetDetailView,
  AssetEnrichmentView,
  AssetStatus,
  SavedSearchPayload,
  SavedSearchView,
  SearchFilters,
  SearchResult
};
