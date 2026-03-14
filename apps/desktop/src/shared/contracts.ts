export type AssetStatus = 'imported' | 'indexing' | 'ready' | 'failed';

export type Orientation = 'portrait' | 'landscape' | 'square';

export type AspectBucket = 'ultrawide' | 'wide' | 'standard' | 'portrait' | 'tall' | 'square';

export type DominantColorFamily =
  | 'red'
  | 'orange'
  | 'yellow'
  | 'green'
  | 'teal'
  | 'blue'
  | 'purple'
  | 'pink'
  | 'brown'
  | 'black'
  | 'white'
  | 'gray';

export interface AssetTagView {
  id: string;
  name: string;
}

export interface AssetCollectionView {
  id: string;
  name: string;
}

export interface AssetEnrichmentView {
  ocrText: string;
  dominantColors: DominantColorFamily[];
  orientation: Orientation;
  aspectBucket: AspectBucket;
  hasText: boolean;
  exif: Record<string, string | number | boolean | null>;
  extractionVersion: number;
  updatedAt: string;
}

export interface AppAssetView {
  id: string;
  createdAt: string;
  importSource: 'drag-drop' | 'file-picker' | 'folder' | 'clipboard';
  mime: string;
  width: number;
  height: number;
  status: AssetStatus;
  thumbnailPath: string | null;
  thumbnailUpdatedAt: string | null;
  originalPath: string;
  title: string;
  userNote: string;
  retrievalCaption: string;
  tags: string[];
  collections: string[];
  dominantColors: DominantColorFamily[];
  orientation: Orientation;
  aspectBucket: AspectBucket;
  hasText: boolean;
}

export interface AssetDetailView extends AppAssetView {
  checksum: string;
  sourcePath: string;
  metadata: Record<string, unknown>;
  searchDocument: string;
  searchDocumentSections: Array<{ section: string; content: string }>;
  tagEntries: AssetTagView[];
  collectionEntries: AssetCollectionView[];
  enrichment: AssetEnrichmentView;
}

export interface SearchFilters {
  mimePrefix?: string;
  status?: AssetStatus | 'all';
  collectionNames?: string[];
  tagNames?: string[];
  orientation?: Orientation | 'all';
  aspectBuckets?: AspectBucket[];
  dominantColors?: DominantColorFamily[];
  hasText?: boolean | null;
  onlyOfflineReady?: boolean;
}

export interface SearchExplanation {
  vectorScore: number;
  lexicalScore: number;
  metadataScore: number;
  recencyBoost: number;
  matchedFields: string[];
  matchedTerms: string[];
  matchedTags: string[];
  matchedCollections: string[];
  matchedColors: DominantColorFamily[];
  snippet: string;
}

export interface SearchResult {
  assetId: string;
  score: number;
  reasons: string[];
  explanation: SearchExplanation;
}

export interface SavedSearchPayload {
  name: string;
  searchText: string;
  searchMode: 'semantic' | 'similar-image';
  filters: SearchFilters;
}

export interface SavedSearchView extends SavedSearchPayload {
  id: string;
  createdAt: string;
  updatedAt: string;
}
