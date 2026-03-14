import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type {
  AppAssetView,
  AssetCollectionView,
  AssetDetailView,
  AssetTagView,
  SavedSearchPayload,
  SavedSearchView,
  SearchExplanation,
  SearchFilters,
  SearchResult,
  SuggestedTagView
} from '../shared/contracts';
import { formatColorFamilyLabel, formatImportSourceLabel } from '../shared/assetMetadata';
import { GEMINI_EMBEDDING_MODEL, getGeminiApiSettings } from '../shared/gemini';
import {
  getAdjacentViewerAssetId,
  getViewerAssetIndex,
  shouldBlockViewerKeyboardNavigation,
  viewerAssetStillVisible
} from './assetViewer';
import { buildLibraryAssetUrl, buildThumbnailSrc } from './assetUrls';
import {
  clampGridColumns,
  DEFAULT_GRID_COLUMNS,
  formatGridColumnsLabel,
  MAX_GRID_COLUMNS,
  MIN_GRID_COLUMNS
} from './gridControls';
import { assetMatchesFilters, deriveSavedSearchName, toggleStringFilter } from './libraryFilters';

type Asset = AppAssetView;

type VectorSpaceApi = Window['vectorSpace'];

type Job = {
  assetId: string;
  stage: string;
  status: 'queued' | 'running' | 'success' | 'failed';
  error: string | null;
  updatedAt: string;
};

type BatchMode = 'tag' | 'collection' | null;

const statusLabel: Record<Asset['status'], string> = {
  imported: 'Imported',
  indexing: 'Indexing',
  ready: 'Ready',
  failed: 'Failed'
};

const DEFAULT_FILTERS: SearchFilters = {
  mimePrefix: '',
  status: 'all',
  collectionNames: [],
  tagNames: [],
  orientation: 'all',
  aspectBuckets: [],
  dominantColors: [],
  hasText: null,
  onlyOfflineReady: false
};

const parseErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }

  return 'Unexpected error';
};

const formatAssetLabel = (asset: Pick<Asset, 'originalPath' | 'id'> | null) => {
  if (!asset) {
    return 'Unknown asset';
  }

  const parts = asset.originalPath.split(/[/\\]/);
  return (parts.at(-1) ?? asset.id).toUpperCase();
};

const formatJobUpdatedAt = (isoTimestamp: string): string => {
  const timestamp = new Date(isoTimestamp);
  if (Number.isNaN(timestamp.getTime())) {
    return 'Updated just now';
  }

  return `Updated ${timestamp.toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit'
  })}`;
};

const summarizeJobError = (error: string | null) => {
  if (!error) {
    return '';
  }

  if (error.includes('NOT_FOUND')) {
    return 'The configured Gemini embedding model was not available for that run.';
  }

  if (error.includes('INVALID_ARGUMENT')) {
    return 'Gemini rejected the request payload for that run.';
  }

  return error;
};

const formatCreatedAt = (isoTimestamp: string) => {
  const timestamp = new Date(isoTimestamp);
  if (Number.isNaN(timestamp.getTime())) {
    return 'Unknown import time';
  }

  return timestamp.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
};

const formatFileSize = (size: number) => {
  if (!size) {
    return 'Unknown file size';
  }

  if (size < 1024) {
    return `${size} B`;
  }

  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }

  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
};

const formatOcrRotation = (rotation: 0 | 90 | 180 | 270) =>
  rotation === 0 ? 'upright' : `${rotation}° corrected`;

const formatSuggestionSource = (source: SuggestedTagView['source']) => {
  switch (source) {
    case 'ocr':
      return 'OCR';
    case 'path':
      return 'Path';
    case 'neighbor':
      return 'Similar asset';
    default:
      return 'Metadata';
  }
};

const previewPalettes = [
  '#f97316',
  '#22c55e',
  '#38bdf8',
  '#e879f9',
  '#f43f5e',
  '#6366f1',
  '#eab308',
  '#14b8a6',
  '#84cc16',
  '#ef4444',
  '#8b5cf6',
  '#06b6d4'
];

const createPreviewThumb = (label: string, color: string): string => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="480"><rect width="100%" height="100%" fill="${color}"/><circle cx="620" cy="92" r="80" fill="rgba(255,255,255,0.18)"/><circle cx="120" cy="410" r="130" fill="rgba(255,255,255,0.12)"/><text x="50%" y="53%" text-anchor="middle" dominant-baseline="middle" fill="rgba(255,255,255,0.94)" font-size="48" font-family="Inter,Arial,sans-serif" font-weight="600">${label}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
};

const buildPreviewExplanation = (assetId: string): SearchExplanation => ({
  vectorScore: assetId.endsWith('1') ? 0.92 : 0.67,
  lexicalScore: assetId.endsWith('1') ? 0.28 : 0.14,
  metadataScore: 0.22,
  recencyBoost: 0.02,
  matchedFields: ['title', 'ocr', 'search document'],
  matchedTerms: ['dashboard', 'editorial'],
  matchedTags: ['demo'],
  matchedOcrTerms: ['dashboard'],
  matchedPathTerms: ['editorial'],
  matchedCollections: ['showcase'],
  matchedColors: ['blue'],
  snippet: 'Demo snippet showing how the search document and metadata will surface in the UI.'
});

const createPreviewApi = (): VectorSpaceApi => {
  const demoAssets: Asset[] = Array.from({ length: 48 }, (_, index) => {
    const palette = previewPalettes[index % previewPalettes.length];
    const sequence = String(index + 1).padStart(4, '0');
    const width = [1024, 1280, 960, 1440, 800, 1080][index % 6];
    const height = [1024, 720, 1280, 900, 1200, 1080][index % 6];
    const status: Asset['status'] = index % 11 === 0 ? 'indexing' : 'ready';
    const orientation = width === height ? 'square' : width > height ? 'landscape' : 'portrait';
    const aspectBucket =
      width === height
        ? 'square'
        : width / height >= 1.4
          ? 'wide'
          : width / height <= 0.6
            ? 'tall'
            : width > height
              ? 'standard'
              : 'portrait';

    return {
      id: `demo-${sequence}`,
      createdAt: new Date(Date.now() - index * 3_600_000).toISOString(),
      importSource: index % 4 === 0 ? 'clipboard' : 'folder',
      mime: 'image/png',
      width,
      height,
      status,
      thumbnailPath: createPreviewThumb(`DEMO ${index + 1}`, palette),
      thumbnailUpdatedAt: new Date(Date.now() - index * 3_600_000).toISOString(),
      originalPath: `/demo/color-study-${sequence}.png`,
      title: `Color Study ${index + 1}`,
      userNote: index % 3 === 0 ? 'High-contrast composition with visible text treatment.' : '',
      retrievalCaption: 'Color study. Demo metadata-rich archive asset.',
      tags: index % 2 === 0 ? ['color', 'demo'] : ['demo'],
      collections: index % 3 === 0 ? ['showcase'] : ['seed'],
      dominantColors: ['blue', 'orange'],
      orientation,
      aspectBucket,
      hasText: index % 3 === 0
    };
  });

  const tags: AssetTagView[] = [
    { id: 'tag-color', name: 'color' },
    { id: 'tag-demo', name: 'demo' },
    { id: 'tag-editorial', name: 'editorial' }
  ];
  const collections: AssetCollectionView[] = [
    { id: 'col-showcase', name: 'showcase' },
    { id: 'col-seed', name: 'seed' },
    { id: 'col-archive', name: 'archive' }
  ];

  const detailMap = new Map<string, AssetDetailView>(
    demoAssets.map((asset) => [
      asset.id,
      {
        ...asset,
        checksum: asset.id,
        sourcePath: asset.originalPath,
        fileSizeBytes: 512_000,
        metadata: {
          sourceType: 'preview',
          aspectRatio: Number((asset.width / asset.height).toFixed(3))
        },
        searchDocument: `${asset.title}\n${asset.retrievalCaption}\n${asset.tags.join(' ')}\n${asset.collections.join(' ')}`,
        searchDocumentSections: [
          { section: 'summary', content: asset.retrievalCaption },
          { section: 'organization', content: [...asset.tags, ...asset.collections].join(' ') }
        ],
        tagEntries: asset.tags.map(
          (name) => tags.find((tag) => tag.name === name) ?? { id: name, name }
        ),
        collectionEntries: asset.collections.map(
          (name) => collections.find((collection) => collection.name === name) ?? { id: name, name }
        ),
        suggestedTags: asset.hasText
          ? [
              {
                value: 'typography',
                source: 'ocr',
                confidence: 0.88,
                status: 'pending',
                updatedAt: asset.createdAt
              },
              {
                value: 'showcase',
                source: 'neighbor',
                confidence: 0.74,
                status: 'pending',
                updatedAt: asset.createdAt
              }
            ]
          : [
              {
                value: 'blue',
                source: 'metadata',
                confidence: 0.9,
                status: 'pending',
                updatedAt: asset.createdAt
              }
            ],
        enrichment: {
          ocrText: asset.hasText ? 'Preview OCR text\nHeadline treatment' : '',
          ocrLines: asset.hasText ? ['Preview OCR text', 'Headline treatment'] : [],
          ocrRotation: 0,
          pathTokens: ['demo', 'preview', 'archive'],
          dominantColors: asset.dominantColors,
          orientation: asset.orientation,
          aspectBucket: asset.aspectBucket,
          hasText: asset.hasText,
          exif: {},
          extractionVersion: 2,
          updatedAt: asset.createdAt
        }
      }
    ])
  );

  const savedSearches: SavedSearchView[] = [
    {
      id: 'saved-1',
      name: 'Demo editorial',
      searchText: 'editorial typography',
      searchMode: 'semantic',
      filters: {
        ...DEFAULT_FILTERS,
        tagNames: ['demo']
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  ];

  return {
    appName: 'Vector Space Library (Preview Mode)',
    listAssets: async () => demoAssets,
    getAssetDetail: async (assetId: string) => detailMap.get(assetId) ?? null,
    listJobs: async () => [
      {
        assetId: 'demo-0001',
        stage: 'embedding',
        status: 'running',
        error: null,
        updatedAt: new Date().toISOString()
      },
      {
        assetId: 'demo-0006',
        stage: 'embedding',
        status: 'queued',
        error: null,
        updatedAt: new Date(Date.now() - 30_000).toISOString()
      },
      {
        assetId: 'demo-0009',
        stage: 'embedding',
        status: 'failed',
        error: 'The configured Gemini embedding model was not available for that run.',
        updatedAt: new Date(Date.now() - 300_000).toISOString()
      }
    ],
    listTags: async () => tags,
    listCollections: async () => collections,
    listSavedSearches: async () => savedSearches,
    importFiles: async () => ({ imported: 0, skipped: 0 }),
    importFolder: async () => ({ imported: 0, skipped: 0 }),
    importClipboard: async () => ({ imported: 0, skipped: 0 }),
    seedDemoData: async () => ({ imported: 48, skipped: 0, outputDir: 'preview-mode' }),
    openFileDialog: async () => [],
    openFolderDialog: async () => null,
    createCollection: async () => ({ id: 'preview-collection' }),
    createTag: async () => ({ id: 'preview-tag' }),
    attachCollection: async () => ({ ok: true }),
    attachTag: async () => ({ ok: true }),
    detachCollection: async () => ({ ok: true }),
    detachTag: async () => ({ ok: true }),
    batchAssignTags: async () => ({ ok: true }),
    batchAssignCollections: async () => ({ ok: true }),
    batchAcceptSuggestedTags: async () => ({ ok: true, accepted: 0 }),
    updateAssetMetadata: async (assetId: string, payload: { title: string; userNote: string }) => {
      const detail = detailMap.get(assetId) ?? null;
      if (!detail) {
        return null;
      }

      detail.title = payload.title;
      detail.userNote = payload.userNote;
      detail.searchDocument = [detail.title, detail.userNote, detail.retrievalCaption]
        .join('\n')
        .trim();
      return detail;
    },
    rerunEnrichment: async () => ({ ok: true }),
    acceptSuggestedTags: async (assetId: string, values: string[]) => {
      const detail = detailMap.get(assetId) ?? null;
      if (!detail) {
        return null;
      }

      const accepted = new Set(values);
      detail.suggestedTags = detail.suggestedTags.map((suggestion) =>
        accepted.has(suggestion.value) ? { ...suggestion, status: 'accepted' } : suggestion
      );
      detail.tags = Array.from(new Set([...detail.tags, ...values]));
      detail.tagEntries = detail.tags.map((name) => ({ id: name, name }));
      return detail;
    },
    rejectSuggestedTags: async (assetId: string, values: string[]) => {
      const detail = detailMap.get(assetId) ?? null;
      if (!detail) {
        return null;
      }

      const rejected = new Set(values);
      detail.suggestedTags = detail.suggestedTags.map((suggestion) =>
        rejected.has(suggestion.value) ? { ...suggestion, status: 'rejected' } : suggestion
      );
      return detail;
    },
    pauseIndexing: async () => ({ ok: true }),
    resumeIndexing: async () => ({ ok: true }),
    reindex: async () => ({ ok: true }),
    retryAssets: async () => ({ ok: true }),
    searchText: async () =>
      demoAssets.slice(0, 8).map((asset, index) => ({
        assetId: asset.id,
        score: 0.94 - index * 0.04,
        reasons: ['joint similarity', 'OCR text match', 'accepted tag match'],
        explanation: buildPreviewExplanation(asset.id)
      })),
    searchImage: async () =>
      demoAssets.slice(0, 8).map((asset, index) => ({
        assetId: asset.id,
        score: 0.98 - index * 0.05,
        reasons: ['visual similarity', 'matching color filter'],
        explanation: buildPreviewExplanation(asset.id)
      })),
    searchSimilarToAsset: async () =>
      demoAssets.slice(1, 9).map((asset, index) => ({
        assetId: asset.id,
        score: 0.99 - index * 0.05,
        reasons: ['visual similarity', 'accepted tag match'],
        explanation: buildPreviewExplanation(asset.id)
      })),
    saveSearch: async (payload: SavedSearchPayload) => ({
      id: `saved-${savedSearches.length + 1}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...payload
    }),
    deleteSavedSearch: async () => ({ ok: true }),
    getNetworkState: async () => ({ online: true }),
    setNetworkState: async (nextOnline: boolean) => ({ online: nextOnline }),
    getApiSettings: async () => getGeminiApiSettings(true),
    setApiKey: async () => ({ hasApiKey: true }),
    clearApiKey: async () => ({ hasApiKey: false })
  };
};

const getRendererApi = (): VectorSpaceApi => {
  const maybeApi = (window as Window & { vectorSpace?: VectorSpaceApi }).vectorSpace;

  if (maybeApi) {
    return maybeApi;
  }

  const isElectronRenderer = navigator.userAgent.toLowerCase().includes('electron');
  if (isElectronRenderer) {
    throw new Error('Vector Space preload API is unavailable in Electron.');
  }

  return createPreviewApi();
};

const formatExplanationSummary = (explanation: SearchExplanation): string[] => {
  const summary: string[] = [];
  if (explanation.matchedFields.length > 0) {
    summary.push(`fields: ${explanation.matchedFields.join(', ')}`);
  }
  if (explanation.matchedTags.length > 0) {
    summary.push(`tags: ${explanation.matchedTags.join(', ')}`);
  }
  if (explanation.matchedOcrTerms.length > 0) {
    summary.push(`ocr: ${explanation.matchedOcrTerms.join(', ')}`);
  }
  if (explanation.matchedPathTerms.length > 0) {
    summary.push(`path: ${explanation.matchedPathTerms.join(', ')}`);
  }
  if (explanation.matchedCollections.length > 0) {
    summary.push(`collections: ${explanation.matchedCollections.join(', ')}`);
  }
  if (explanation.matchedTerms.length > 0) {
    summary.push(`terms: ${explanation.matchedTerms.join(', ')}`);
  }
  return summary;
};

export const App = () => {
  const api = useMemo(() => getRendererApi(), []);
  const batchBarRef = useRef<HTMLDivElement | null>(null);
  const apiHasBridge = Boolean((window as Window & { vectorSpace?: VectorSpaceApi }).vectorSpace);

  const [assets, setAssets] = useState<Asset[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [savedSearches, setSavedSearches] = useState<SavedSearchView[]>([]);
  const [search, setSearch] = useState('');
  const [searchMode, setSearchMode] = useState<'semantic' | 'similar-image'>('semantic');
  const [similarSourceAssetId, setSimilarSourceAssetId] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<Record<string, SearchResult>>({});
  const [focusedAssetId, setFocusedAssetId] = useState<string | null>(null);
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([]);
  const [message, setMessage] = useState('Ready');
  const [busy, setBusy] = useState(false);
  const [tags, setTags] = useState<AssetTagView[]>([]);
  const [collections, setCollections] = useState<AssetCollectionView[]>([]);
  const [filters, setFilters] = useState<SearchFilters>(DEFAULT_FILTERS);
  const [online, setOnline] = useState(true);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [hasApiKey, setHasApiKey] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showJobs, setShowJobs] = useState(false);
  const [viewerAssetId, setViewerAssetId] = useState<string | null>(null);
  const [viewerDetail, setViewerDetail] = useState<AssetDetailView | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [noteDraft, setNoteDraft] = useState('');
  const [viewerTagInput, setViewerTagInput] = useState('');
  const [viewerCollectionInput, setViewerCollectionInput] = useState('');
  const [viewerSuggestedTagSelection, setViewerSuggestedTagSelection] = useState<string[]>([]);
  const [batchMode, setBatchMode] = useState<BatchMode>(null);
  const [batchTagInput, setBatchTagInput] = useState('');
  const [batchCollectionInput, setBatchCollectionInput] = useState('');
  const [batchTagId, setBatchTagId] = useState('');
  const [batchCollectionId, setBatchCollectionId] = useState('');
  const [savedSearchName, setSavedSearchName] = useState('');
  const [apiModel, setApiModel] = useState<string>(GEMINI_EMBEDDING_MODEL);
  const [gridColumns, setGridColumns] = useState(DEFAULT_GRID_COLUMNS);

  const runAction = useCallback(async (label: string, action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } catch (error: unknown) {
      setMessage(`${label} failed: ${parseErrorMessage(error)}`);
    } finally {
      setBusy(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    const [assetRows, jobRows, tagRows, collectionRows, savedRows, networkState, apiSettings] =
      await Promise.all([
        api.listAssets(),
        api.listJobs(),
        api.listTags(),
        api.listCollections(),
        api.listSavedSearches(),
        api.getNetworkState(),
        api.getApiSettings()
      ]);

    setAssets(assetRows);
    setJobs(jobRows as Job[]);
    setTags(tagRows);
    setCollections(collectionRows);
    setSavedSearches(savedRows);
    setOnline(networkState.online);
    setHasApiKey(apiSettings.hasApiKey);
    setApiModel(apiSettings.model);
  }, [api]);

  const loadAssetDetail = useCallback(
    async (assetId: string | null) => {
      if (!assetId) {
        setViewerDetail(null);
        setTitleDraft('');
        setNoteDraft('');
        return;
      }

      setDetailLoading(true);
      try {
        const detail = await api.getAssetDetail(assetId);
        setViewerDetail(detail);
        setTitleDraft(detail?.title ?? '');
        setNoteDraft(detail?.userNote ?? '');
      } finally {
        setDetailLoading(false);
      }
    },
    [api]
  );

  useEffect(() => {
    void runAction('Refresh', async () => {
      await refresh();
    });

    const timer = setInterval(() => {
      void refresh();
    }, 2000);

    const onPaste = async (event: ClipboardEvent) => {
      if (!event.clipboardData) return;
      const hasImage = Array.from(event.clipboardData.items).some((item) =>
        item.type.startsWith('image/')
      );

      if (!hasImage) {
        return;
      }

      await runAction('Clipboard import', async () => {
        const result = await api.importClipboard();
        setMessage(`Clipboard import: ${result.imported} imported, ${result.skipped} skipped`);
        await refresh();
      });
    };

    document.addEventListener('paste', onPaste);
    return () => {
      clearInterval(timer);
      document.removeEventListener('paste', onPaste);
    };
  }, [api, refresh, runAction]);

  useEffect(() => {
    if (viewerAssetId) {
      void loadAssetDetail(viewerAssetId);
    }
  }, [loadAssetDetail, viewerAssetId]);

  useEffect(() => {
    setViewerSuggestedTagSelection([]);
  }, [viewerDetail?.id]);

  useEffect(() => {
    if (batchMode && batchBarRef.current) {
      batchBarRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [batchMode, selectedAssetIds.length]);

  const onImportFiles = async () => {
    await runAction('File import', async () => {
      const files = await api.openFileDialog();
      if (!files.length) return;
      const result = await api.importFiles(files);
      setMessage(`Imported ${result.imported}, skipped ${result.skipped}`);
      await refresh();
    });
  };

  const onImportFolder = async () => {
    await runAction('Folder import', async () => {
      const folder = await api.openFolderDialog();
      if (!folder) return;
      const result = await api.importFolder(folder);
      setMessage(`Folder import: ${result.imported}, skipped ${result.skipped}`);
      await refresh();
    });
  };

  const onDrop: React.DragEventHandler<HTMLElement> = async (event) => {
    event.preventDefault();

    await runAction('Drag/drop import', async () => {
      const files = Array.from(event.dataTransfer.files).map(
        (file) => (file as File & { path?: string }).path ?? ''
      );
      const validFiles = files.filter((item) => item.length > 0);
      if (!validFiles.length) return;
      const result = await api.importFiles(validFiles);
      setMessage(`Drag/drop import: ${result.imported}, skipped ${result.skipped}`);
      await refresh();
    });
  };

  const executeSearch = useCallback(
    async (
      query: string,
      nextMode: 'semantic' | 'similar-image',
      nextFilters: SearchFilters,
      similarAssetId?: string | null
    ) => {
      if (!query.trim() && !similarAssetId) {
        setSearchResults({});
        setSimilarSourceAssetId(null);
        setMessage('Search cleared');
        return;
      }

      const rows =
        nextMode === 'semantic'
          ? await api.searchText(query, nextFilters)
          : similarAssetId
            ? await api.searchSimilarToAsset(similarAssetId, nextFilters)
            : await api.searchImage(query, '', nextFilters);

      const mapped: Record<string, SearchResult> = {};
      rows.forEach((row) => {
        mapped[row.assetId] = row;
      });

      setSearchResults(mapped);
      setSimilarSourceAssetId(nextMode === 'similar-image' && similarAssetId ? similarAssetId : null);
      setMessage(
        nextMode === 'similar-image' && similarAssetId
          ? `Found ${rows.length} related images`
          : `Search returned ${rows.length} results`
      );
    },
    [api]
  );

  const runFindSimilar = useCallback(
    async (assetId: string, closeViewer = true) => {
      const asset = assets.find((candidate) => candidate.id === assetId) ?? null;
      if (!asset) {
        return;
      }

      await runAction('Find similar', async () => {
        setSearchMode('similar-image');
        setSearch(asset.originalPath);
        await executeSearch(asset.originalPath, 'similar-image', filters, assetId);
        if (closeViewer) {
          setViewerAssetId(null);
        }
      });
    },
    [assets, executeSearch, filters, runAction]
  );

  const runSearch = async () => {
    await runAction('Search', async () => {
      await executeSearch(search, searchMode, filters, similarSourceAssetId);
    });
  };

  const applyFilters = (nextFilters: SearchFilters) => {
    setFilters(nextFilters);
    if (search.trim() || similarSourceAssetId) {
      void runAction('Search refresh', async () => {
        await executeSearch(search, searchMode, nextFilters, similarSourceAssetId);
      });
    }
  };

  const availableMimeOptions = useMemo(
    () => ['', ...Array.from(new Set(assets.map((asset) => asset.mime))).sort()],
    [assets]
  );
  const availableColors = useMemo(
    () =>
      Array.from(new Set(assets.flatMap((asset) => asset.dominantColors)))
        .filter(Boolean)
        .sort(),
    [assets]
  );

  const filteredAssets = useMemo(() => {
    let working = assets.filter((asset) => assetMatchesFilters(asset, filters));

    if (Object.keys(searchResults).length > 0) {
      working = working
        .filter((asset) => Boolean(searchResults[asset.id]))
        .sort((a, b) => (searchResults[b.id]?.score ?? 0) - (searchResults[a.id]?.score ?? 0));
    }

    return working;
  }, [assets, filters, searchResults]);

  const assetMap = useMemo(() => new Map(assets.map((asset) => [asset.id, asset])), [assets]);
  const selectedAssetIdSet = useMemo(() => new Set(selectedAssetIds), [selectedAssetIds]);
  const viewerAsset = useMemo(
    () => (viewerAssetId ? (assetMap.get(viewerAssetId) ?? null) : null),
    [assetMap, viewerAssetId]
  );
  const viewerIndex = useMemo(
    () => getViewerAssetIndex(viewerAssetId, filteredAssets),
    [filteredAssets, viewerAssetId]
  );
  const focusedAsset = useMemo(
    () => (focusedAssetId ? (assetMap.get(focusedAssetId) ?? null) : null),
    [assetMap, focusedAssetId]
  );
  const similarSourceAsset = useMemo(
    () => (similarSourceAssetId ? (assetMap.get(similarSourceAssetId) ?? null) : null),
    [assetMap, similarSourceAssetId]
  );
  const viewerPendingSuggestions = useMemo(
    () => (viewerDetail?.suggestedTags ?? []).filter((suggestion) => suggestion.status === 'pending'),
    [viewerDetail]
  );
  const viewerDismissedSuggestionCount = useMemo(
    () => (viewerDetail?.suggestedTags ?? []).filter((suggestion) => suggestion.status === 'rejected').length,
    [viewerDetail]
  );

  const openAssetViewer = useCallback((assetId: string) => {
    setFocusedAssetId(assetId);
    setSelectedAssetIds([assetId]);
    setViewerAssetId(assetId);
  }, []);

  const closeAssetViewer = useCallback(() => {
    setViewerAssetId(null);
  }, []);

  const navigateViewer = useCallback(
    (direction: 'previous' | 'next') => {
      const nextAssetId = getAdjacentViewerAssetId(viewerAssetId, filteredAssets, direction);
      if (!nextAssetId || nextAssetId === viewerAssetId) {
        return;
      }

      setFocusedAssetId(nextAssetId);
      setSelectedAssetIds([nextAssetId]);
      setViewerAssetId(nextAssetId);
    },
    [filteredAssets, viewerAssetId]
  );

  const canViewPreviousAsset = viewerIndex > 0;
  const canViewNextAsset = viewerIndex !== -1 && viewerIndex < filteredAssets.length - 1;

  useEffect(() => {
    if (!viewerAssetId) {
      return;
    }

    if (!viewerAssetStillVisible(viewerAssetId, filteredAssets)) {
      setViewerAssetId(null);
    }
  }, [filteredAssets, viewerAssetId]);

  useEffect(() => {
    if (!viewerAssetId) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (shouldBlockViewerKeyboardNavigation(event.target)) {
        return;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        closeAssetViewer();
        return;
      }

      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        navigateViewer('previous');
      }

      if (event.key === 'ArrowRight') {
        event.preventDefault();
        navigateViewer('next');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [closeAssetViewer, navigateViewer, viewerAssetId]);

  const selectExclusive = (assetId: string) => {
    setFocusedAssetId(assetId);
    setSelectedAssetIds([assetId]);
  };

  const toggleAssetSelection = (assetId: string) => {
    setFocusedAssetId(assetId);
    setSelectedAssetIds((current) =>
      current.includes(assetId)
        ? current.filter((currentId) => currentId !== assetId)
        : [...current, assetId]
    );
  };

  const queueBatchMode = (mode: Exclude<BatchMode, null>, assetId: string) => {
    selectExclusive(assetId);
    setBatchMode(mode);
  };

  const refreshAfterMutation = async (assetIds: string[] = []) => {
    await refresh();
    if (viewerAssetId && assetIds.includes(viewerAssetId)) {
      await loadAssetDetail(viewerAssetId);
    }
  };

  const saveAssetMetadata = async () => {
    if (!viewerAsset) {
      return;
    }

    await runAction('Save asset metadata', async () => {
      const detail = await api.updateAssetMetadata(viewerAsset.id, {
        title: titleDraft,
        userNote: noteDraft
      });
      setViewerDetail(detail);
      setMessage('Asset metadata saved');
      await refresh();
    });
  };

  const attachTag = async (assetId: string, tagId: string) => {
    await api.attachTag(assetId, tagId);
    await refreshAfterMutation([assetId]);
  };

  const detachTag = async (assetId: string, tagId: string) => {
    await api.detachTag(assetId, tagId);
    await refreshAfterMutation([assetId]);
  };

  const attachCollection = async (assetId: string, collectionId: string) => {
    await api.attachCollection(assetId, collectionId);
    await refreshAfterMutation([assetId]);
  };

  const detachCollection = async (assetId: string, collectionId: string) => {
    await api.detachCollection(assetId, collectionId);
    await refreshAfterMutation([assetId]);
  };

  const createAndAttachViewerTag = async () => {
    if (!viewerAsset || !viewerTagInput.trim()) {
      setMessage('Tag name cannot be empty');
      return;
    }

    await runAction('Add tag', async () => {
      const response = await api.createTag(viewerTagInput.trim());
      await attachTag(viewerAsset.id, response.id);
      setViewerTagInput('');
      setMessage('Tag attached');
    });
  };

  const createAndAttachViewerCollection = async () => {
    if (!viewerAsset || !viewerCollectionInput.trim()) {
      setMessage('Collection name cannot be empty');
      return;
    }

    await runAction('Add collection', async () => {
      const response = await api.createCollection(viewerCollectionInput.trim());
      await attachCollection(viewerAsset.id, response.id);
      setViewerCollectionInput('');
      setMessage('Collection attached');
    });
  };

  const applyBatchTag = async () => {
    if (selectedAssetIds.length === 0) {
      setMessage('Select assets first');
      return;
    }

    await runAction('Batch tag', async () => {
      let tagId = batchTagId;
      if (!tagId && batchTagInput.trim()) {
        const response = await api.createTag(batchTagInput.trim());
        tagId = response.id;
      }

      if (!tagId) {
        setMessage('Choose or create a tag');
        return;
      }

      await api.batchAssignTags(selectedAssetIds, tagId);
      setBatchTagId('');
      setBatchTagInput('');
      setMessage(`Tagged ${selectedAssetIds.length} assets`);
      await refreshAfterMutation(selectedAssetIds);
    });
  };

  const applyBatchCollection = async () => {
    if (selectedAssetIds.length === 0) {
      setMessage('Select assets first');
      return;
    }

    await runAction('Batch collection', async () => {
      let collectionId = batchCollectionId;
      if (!collectionId && batchCollectionInput.trim()) {
        const response = await api.createCollection(batchCollectionInput.trim());
        collectionId = response.id;
      }

      if (!collectionId) {
        setMessage('Choose or create a collection');
        return;
      }

      await api.batchAssignCollections(selectedAssetIds, collectionId);
      setBatchCollectionId('');
      setBatchCollectionInput('');
      setMessage(`Added ${selectedAssetIds.length} assets to a collection`);
      await refreshAfterMutation(selectedAssetIds);
    });
  };

  const retryAssets = async (assetIds: string[], label: string) => {
    await runAction(label, async () => {
      const uniqueAssetIds = Array.from(new Set(assetIds));
      if (uniqueAssetIds.length === 0) {
        setMessage('Nothing to retry');
        return;
      }

      await api.retryAssets(uniqueAssetIds);
      setMessage(
        uniqueAssetIds.length === 1
          ? 'Asset requeued for indexing'
          : `Requeued ${uniqueAssetIds.length} assets for indexing`
      );
      await refresh();
    });
  };

  const rerunEnrichment = async (assetIds: string[], label: string) => {
    await runAction(label, async () => {
      const uniqueAssetIds = Array.from(new Set(assetIds));
      if (uniqueAssetIds.length === 0) {
        setMessage('Nothing to enrich');
        return;
      }

      await api.rerunEnrichment(uniqueAssetIds);
      setMessage(
        uniqueAssetIds.length === 1
          ? 'Asset requeued for enrichment'
          : `Requeued ${uniqueAssetIds.length} assets for enrichment`
      );
      await refresh();
    });
  };

  const acceptSuggestedTags = async (assetId: string, values: string[]) => {
    await runAction('Apply suggested tags', async () => {
      const detail = await api.acceptSuggestedTags(assetId, values);
      setViewerDetail(detail);
      setViewerSuggestedTagSelection([]);
      setMessage(`Applied ${values.length} suggested tag${values.length === 1 ? '' : 's'}`);
      await refreshAfterMutation([assetId]);
    });
  };

  const rejectSuggestedTags = async (assetId: string, values: string[]) => {
    await runAction('Dismiss suggested tags', async () => {
      const detail = await api.rejectSuggestedTags(assetId, values);
      setViewerDetail(detail);
      setViewerSuggestedTagSelection((current) =>
        current.filter((value) => !values.includes(value))
      );
      setMessage(`Dismissed ${values.length} suggestion${values.length === 1 ? '' : 's'}`);
      await refreshAfterMutation([assetId]);
    });
  };

  const batchAcceptSelectionSuggestions = async () => {
    await runAction('Apply suggested tags for selection', async () => {
      const result = await api.batchAcceptSuggestedTags(selectedAssetIds);
      setMessage(
        result.accepted > 0
          ? `Applied ${result.accepted} suggested tag${result.accepted === 1 ? '' : 's'}`
          : 'No pending suggestions to apply'
      );
      await refreshAfterMutation(selectedAssetIds);
    });
  };

  const saveCurrentSearch = async () => {
    await runAction('Save search', async () => {
      const payload: SavedSearchPayload = {
        name: savedSearchName.trim() || deriveSavedSearchName(search, savedSearches.length + 1),
        searchText: search,
        searchMode,
        filters
      };
      await api.saveSearch(payload);
      setSavedSearchName('');
      setMessage(`Saved "${payload.name}"`);
      await refresh();
    });
  };

  const applySavedSearch = (savedSearch: SavedSearchView) => {
    setSearch(savedSearch.searchText);
    setSearchMode(savedSearch.searchMode);
    setSimilarSourceAssetId(null);
    setFilters(savedSearch.filters);
    if (savedSearch.searchText.trim()) {
      void runAction('Apply saved search', async () => {
        await executeSearch(savedSearch.searchText, savedSearch.searchMode, savedSearch.filters);
      });
    } else {
      setSearchResults({});
    }
  };

  const deleteSavedSearch = async (savedSearchId: string) => {
    await runAction('Delete saved search', async () => {
      await api.deleteSavedSearch(savedSearchId);
      await refresh();
      setMessage('Saved search removed');
    });
  };

  const saveApiKey = async () => {
    await runAction('API key save', async () => {
      if (!apiKeyInput.trim()) {
        setMessage('Enter an API key first');
        return;
      }

      const response = await api.setApiKey(apiKeyInput.trim());
      setHasApiKey(response.hasApiKey);
      setApiKeyInput('');
      setMessage('Gemini API key saved to macOS Keychain');
      await refresh();
    });
  };

  const clearApiKey = async () => {
    await runAction('API key clear', async () => {
      await api.clearApiKey();
      setHasApiKey(false);
      setMessage('Gemini API key removed from macOS Keychain');
    });
  };

  const activeJobs = useMemo(
    () => jobs.filter((job) => job.status === 'running' || job.status === 'queued'),
    [jobs]
  );
  const failedJobs = useMemo(() => jobs.filter((job) => job.status === 'failed'), [jobs]);
  const recentSuccessfulJobs = useMemo(
    () => jobs.filter((job) => job.status === 'success').slice(0, 6),
    [jobs]
  );
  const runningJobs = activeJobs.length;
  const failedJobCount = failedJobs.length;
  const jobPillLabel =
    runningJobs > 0
      ? `Queue ${runningJobs} active${failedJobCount > 0 ? ` · ${failedJobCount} failed` : ''}`
      : failedJobCount > 0
        ? `Queue idle · ${failedJobCount} failed`
        : 'Queue idle';

  const gridStyle = useMemo(
    () =>
      ({
        gridTemplateColumns: `repeat(${gridColumns}, minmax(0, 1fr))`
      }) as CSSProperties,
    [gridColumns]
  );

  const getAssetImageSrc = (asset: Asset) => buildThumbnailSrc(asset);

  const getAssetOriginalSrc = (asset: Asset) => {
    if (asset.originalPath.startsWith('data:')) {
      return asset.originalPath;
    }

    const maybePreviewFallback = asset.thumbnailPath?.startsWith('data:')
      ? asset.thumbnailPath
      : null;
    if (!apiHasBridge && maybePreviewFallback) {
      return maybePreviewFallback;
    }

    return buildLibraryAssetUrl(asset.originalPath);
  };

  return (
    <main className="app-shell" onDragOver={(event) => event.preventDefault()} onDrop={onDrop}>
      <header className="app-header">
        <div className="title-wrap">
          <h1>Your library</h1>
        </div>
        <div className="header-actions">
          <p className="message-pill">{message}</p>
          <label className="header-grid-control" htmlFor="grid-size-slider">
            <span className="grid-size-label">Grid</span>
            <input
              id="grid-size-slider"
              className="grid-size-slider"
              type="range"
              min={MIN_GRID_COLUMNS}
              max={MAX_GRID_COLUMNS}
              step={1}
              value={gridColumns}
              onInput={(event) =>
                setGridColumns(clampGridColumns(Number(event.currentTarget.value)))
              }
              onChange={(event) => setGridColumns(clampGridColumns(Number(event.target.value)))}
              aria-label="Grid columns"
            />
            <output htmlFor="grid-size-slider">{formatGridColumnsLabel(gridColumns)}</output>
          </label>
          <button className="jobs-pill" onClick={() => setShowJobs(true)} disabled={busy}>
            {jobPillLabel}
          </button>
          <button className="settings-btn" onClick={() => setShowSettings(true)} disabled={busy}>
            Settings
          </button>
        </div>
      </header>

      <section className="toolbar panel">
        <div className="toolbar-layout">
          <div className="toolbar-cluster toolbar-imports">
            <button onClick={onImportFiles} disabled={busy}>
              Import Files
            </button>
            <button onClick={onImportFolder} disabled={busy}>
              Import Folder
            </button>
            <button
              onClick={() =>
                void runAction('Seed demo data', async () => {
                  const result = await api.seedDemoData();
                  setMessage(
                    `Seeded demo data: ${result.imported} imported, ${result.skipped} skipped (${result.outputDir})`
                  );
                  await refresh();
                })
              }
              disabled={busy}
            >
              Seed Demo Data
            </button>
            <button
              onClick={() =>
                void runAction('Clipboard import', async () => {
                  const result = await api.importClipboard();
                  setMessage(
                    `Clipboard import: ${result.imported} imported, ${result.skipped} skipped`
                  );
                  await refresh();
                })
              }
              disabled={busy}
            >
              Paste Clipboard
            </button>
          </div>

          <div className="toolbar-cluster toolbar-search">
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={
                searchMode === 'semantic'
                  ? 'Semantic query'
                  : similarSourceAssetId
                    ? 'Related search anchored to the selected asset'
                    : 'Image path'
              }
              disabled={busy}
            />
            <select
              value={searchMode}
              onChange={(event) => {
                const nextMode = event.target.value as 'semantic' | 'similar-image';
                setSearchMode(nextMode);
                if (nextMode === 'semantic') {
                  setSimilarSourceAssetId(null);
                }
              }}
              disabled={busy}
            >
              <option value="semantic">Semantic</option>
              <option value="similar-image">Similar Image</option>
            </select>
            <button onClick={runSearch} disabled={busy || !hasApiKey}>
              Search
            </button>
            <button
              onClick={() => {
                setSearch('');
                setSearchResults({});
                setSimilarSourceAssetId(null);
                setMessage('Search cleared');
              }}
              disabled={busy}
            >
              Clear
            </button>
          </div>
        </div>
      </section>

      <section className="filter-strip panel">
        <div className="saved-search-row">
          <div className="saved-search-list">
            {savedSearches.map((savedSearch) => (
              <button
                key={savedSearch.id}
                className="saved-search-chip"
                onClick={() => applySavedSearch(savedSearch)}
                disabled={busy}
              >
                <span>{savedSearch.name}</span>
                <span
                  className="saved-search-delete"
                  onClick={(event) => {
                    event.stopPropagation();
                    void deleteSavedSearch(savedSearch.id);
                  }}
                >
                  ×
                </span>
              </button>
            ))}
          </div>
          <div className="saved-search-actions">
            <input
              value={savedSearchName}
              onChange={(event) => setSavedSearchName(event.target.value)}
              placeholder="Save current view"
              disabled={busy}
            />
            <button onClick={saveCurrentSearch} disabled={busy}>
              Save Search
            </button>
          </div>
        </div>

        <div className="filter-groups">
          <div className="filter-group">
            <span className="filter-label">Status</span>
            {(['all', 'ready', 'failed', 'indexing', 'imported'] as const).map((status) => (
              <button
                key={status}
                className={`filter-chip ${filters.status === status ? 'filter-chip-active' : ''}`}
                onClick={() => applyFilters({ ...filters, status })}
                disabled={busy}
              >
                {status === 'all' ? 'All' : statusLabel[status]}
              </button>
            ))}
          </div>

          <div className="filter-group">
            <span className="filter-label">Type</span>
            {availableMimeOptions.map((mimePrefix) => (
              <button
                key={mimePrefix || 'all-mimes'}
                className={`filter-chip ${filters.mimePrefix === mimePrefix ? 'filter-chip-active' : ''}`}
                onClick={() => applyFilters({ ...filters, mimePrefix })}
                disabled={busy}
              >
                {mimePrefix ? mimePrefix.replace('image/', '').toUpperCase() : 'All'}
              </button>
            ))}
          </div>

          <div className="filter-group">
            <span className="filter-label">Orientation</span>
            {(['all', 'landscape', 'portrait', 'square'] as const).map((orientation) => (
              <button
                key={orientation}
                className={`filter-chip ${filters.orientation === orientation ? 'filter-chip-active' : ''}`}
                onClick={() => applyFilters({ ...filters, orientation })}
                disabled={busy}
              >
                {orientation === 'all' ? 'Any' : orientation}
              </button>
            ))}
          </div>

          <div className="filter-group">
            <span className="filter-label">Text</span>
            {[
              { label: 'Any', value: null },
              { label: 'Has text', value: true },
              { label: 'No text', value: false }
            ].map((entry) => (
              <button
                key={entry.label}
                className={`filter-chip ${filters.hasText === entry.value ? 'filter-chip-active' : ''}`}
                onClick={() => applyFilters({ ...filters, hasText: entry.value })}
                disabled={busy}
              >
                {entry.label}
              </button>
            ))}
          </div>

          {availableColors.length > 0 ? (
            <div className="filter-group">
              <span className="filter-label">Colors</span>
              {availableColors.map((color) => (
                <button
                  key={color}
                  className={`filter-chip ${
                    filters.dominantColors?.includes(color) ? 'filter-chip-active' : ''
                  }`}
                  onClick={() =>
                    applyFilters({
                      ...filters,
                      dominantColors: toggleStringFilter(
                        filters.dominantColors ?? [],
                        color
                      ) as Asset['dominantColors']
                    })
                  }
                  disabled={busy}
                >
                  {formatColorFamilyLabel(color)}
                </button>
              ))}
            </div>
          ) : null}

          {tags.length > 0 ? (
            <div className="filter-group filter-group-wide">
              <span className="filter-label">Tags</span>
              {tags.map((tag) => (
                <button
                  key={tag.id}
                  className={`filter-chip ${filters.tagNames?.includes(tag.name) ? 'filter-chip-active' : ''}`}
                  onClick={() =>
                    applyFilters({
                      ...filters,
                      tagNames: toggleStringFilter(filters.tagNames ?? [], tag.name)
                    })
                  }
                  disabled={busy}
                >
                  {tag.name}
                </button>
              ))}
            </div>
          ) : null}

          {collections.length > 0 ? (
            <div className="filter-group filter-group-wide">
              <span className="filter-label">Collections</span>
              {collections.map((collection) => (
                <button
                  key={collection.id}
                  className={`filter-chip ${
                    filters.collectionNames?.includes(collection.name) ? 'filter-chip-active' : ''
                  }`}
                  onClick={() =>
                    applyFilters({
                      ...filters,
                      collectionNames: toggleStringFilter(
                        filters.collectionNames ?? [],
                        collection.name
                      )
                    })
                  }
                  disabled={busy}
                >
                  {collection.name}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </section>

      {similarSourceAsset ? (
        <section className="related-search-banner panel">
          <div className="related-search-copy">
            <strong>Similar to</strong>
            <span>{formatAssetLabel(similarSourceAsset)}</span>
          </div>
          <button
            onClick={() => {
              setSimilarSourceAssetId(null);
              setSearch('');
              setSearchResults({});
              setSearchMode('semantic');
              setMessage('Related search cleared');
            }}
            disabled={busy}
          >
            Clear Related Search
          </button>
        </section>
      ) : null}

      {selectedAssetIds.length > 0 ? (
        <section className="batch-bar panel" ref={batchBarRef}>
          <div className="batch-summary">
            <strong>{selectedAssetIds.length} selected</strong>
            <span>
              {selectedAssetIds.length === 1
                ? formatAssetLabel(assetMap.get(selectedAssetIds[0]) ?? null)
                : 'Batch organization controls'}
            </span>
          </div>

          <div className="batch-actions">
            <button
              onClick={() => {
                if (selectedAssetIds.length === 1) {
                  openAssetViewer(selectedAssetIds[0]);
                }
              }}
              disabled={busy || selectedAssetIds.length !== 1}
            >
              View Selected
            </button>
            <button
              onClick={() => void retryAssets(selectedAssetIds, 'Retry selected assets')}
              disabled={busy || !hasApiKey}
            >
              Reindex Selection
            </button>
            <button onClick={() => void batchAcceptSelectionSuggestions()} disabled={busy}>
              Apply Suggestions
            </button>
            <button
              onClick={() => {
                setSelectedAssetIds([]);
                setBatchMode(null);
              }}
              disabled={busy}
            >
              Clear Selection
            </button>
          </div>

          <div className={`batch-editor ${batchMode === 'tag' ? 'batch-editor-active' : ''}`}>
            <label>Tag selection</label>
            <div className="batch-editor-controls">
              <select
                value={batchTagId}
                onChange={(event) => setBatchTagId(event.target.value)}
                disabled={busy}
              >
                <option value="">Choose existing tag</option>
                {tags.map((tag) => (
                  <option key={tag.id} value={tag.id}>
                    {tag.name}
                  </option>
                ))}
              </select>
              <input
                value={batchTagInput}
                onChange={(event) => setBatchTagInput(event.target.value)}
                placeholder="or create tag"
                disabled={busy}
              />
              <button onClick={applyBatchTag} disabled={busy}>
                Apply Tag
              </button>
            </div>
          </div>

          <div
            className={`batch-editor ${batchMode === 'collection' ? 'batch-editor-active' : ''}`}
          >
            <label>Add to collection</label>
            <div className="batch-editor-controls">
              <select
                value={batchCollectionId}
                onChange={(event) => setBatchCollectionId(event.target.value)}
                disabled={busy}
              >
                <option value="">Choose existing collection</option>
                {collections.map((collection) => (
                  <option key={collection.id} value={collection.id}>
                    {collection.name}
                  </option>
                ))}
              </select>
              <input
                value={batchCollectionInput}
                onChange={(event) => setBatchCollectionInput(event.target.value)}
                placeholder="or create collection"
                disabled={busy}
              />
              <button onClick={applyBatchCollection} disabled={busy}>
                Apply Collection
              </button>
            </div>
          </div>
        </section>
      ) : null}

      <section className="content">
        <section className="grid" style={gridStyle}>
          {filteredAssets.length === 0 ? (
            <div className="grid-empty">
              <strong>No assets to show.</strong>
              <p>Import files or loosen the current search and metadata filters.</p>
            </div>
          ) : null}

          {filteredAssets.map((asset) => {
            const imageSrc = getAssetImageSrc(asset);
            const result = searchResults[asset.id];
            return (
              <article
                key={asset.id}
                className={`card ${selectedAssetIdSet.has(asset.id) ? 'card-selected' : ''}`}
                onClick={(event) => {
                  if (event.metaKey || event.ctrlKey) {
                    toggleAssetSelection(asset.id);
                    return;
                  }

                  selectExclusive(asset.id);
                }}
                onDoubleClick={() => openAssetViewer(asset.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    openAssetViewer(asset.id);
                    return;
                  }

                  if (event.key === ' ') {
                    event.preventDefault();
                    toggleAssetSelection(asset.id);
                  }
                }}
                tabIndex={0}
              >
                <button
                  className={`card-select-toggle ${selectedAssetIdSet.has(asset.id) ? 'card-select-toggle-active' : ''}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    toggleAssetSelection(asset.id);
                  }}
                >
                  {selectedAssetIdSet.has(asset.id) ? '✓' : '+'}
                </button>
                <div className="card-media">
                  {imageSrc ? (
                    <img src={imageSrc} alt={asset.id} />
                  ) : (
                    <div className="placeholder" />
                  )}
                </div>
                <div className="card-meta">
                  <div className="card-meta-copy">
                    <strong className="asset-name">{formatAssetLabel(asset)}</strong>
                    <p className="asset-title-line">{asset.title || 'Untitled asset'}</p>
                    <p className="asset-dimensions">
                      <span className="asset-badge">{asset.mime.split('/')[1] ?? asset.mime}</span>
                      <span>
                        {asset.width}×{asset.height}
                      </span>
                      <span className={`status-pill status-${asset.status}`}>
                        {statusLabel[asset.status]}
                      </span>
                    </p>
                    <div className="hover-chip-row">
                      {asset.tags.slice(0, 2).map((tag) => (
                        <span key={`${asset.id}-tag-${tag}`} className="hover-chip">
                          #{tag}
                        </span>
                      ))}
                      {asset.collections.slice(0, 2).map((collection) => (
                        <span
                          key={`${asset.id}-collection-${collection}`}
                          className="hover-chip hover-chip-muted"
                        >
                          {collection}
                        </span>
                      ))}
                    </div>
                    <div className="hover-chip-row">
                      {asset.dominantColors.slice(0, 3).map((color) => (
                        <span key={`${asset.id}-color-${color}`} className="hover-chip">
                          {formatColorFamilyLabel(color)}
                        </span>
                      ))}
                      {asset.hasText ? (
                        <span className="hover-chip hover-chip-muted">Text</span>
                      ) : null}
                    </div>
                    {result ? (
                      <>
                        <p className="reason">Why: {result.reasons.join(', ')}</p>
                        <p className="reason reason-secondary">
                          {formatExplanationSummary(result.explanation).join(' · ') ||
                            result.explanation.snippet}
                        </p>
                      </>
                    ) : null}
                  </div>
                  <div className="card-actions">
                    <button
                      className="card-view-button"
                      onClick={(event) => {
                        event.stopPropagation();
                        openAssetViewer(asset.id);
                      }}
                      disabled={busy}
                    >
                      View
                    </button>
                    <button
                      className="card-quick-button"
                      onClick={(event) => {
                        event.stopPropagation();
                        void runFindSimilar(asset.id, true);
                      }}
                      disabled={busy || !hasApiKey}
                    >
                      Similar
                    </button>
                    <button
                      className="card-quick-button"
                      onClick={(event) => {
                        event.stopPropagation();
                        queueBatchMode('tag', asset.id);
                      }}
                      disabled={busy}
                    >
                      Tag
                    </button>
                    <button
                      className="card-quick-button"
                      onClick={(event) => {
                        event.stopPropagation();
                        queueBatchMode('collection', asset.id);
                      }}
                      disabled={busy}
                    >
                      Collect
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </section>
      </section>

      {viewerAsset ? (
        <div className="settings-backdrop asset-viewer-backdrop" onClick={closeAssetViewer}>
          <section
            className="settings-panel panel asset-viewer-panel"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="asset-viewer-head">
              <div className="asset-viewer-title">
                <h3>{formatAssetLabel(viewerAsset)}</h3>
                <p>
                  <span className={`status-pill status-${viewerAsset.status}`}>
                    {statusLabel[viewerAsset.status]}
                  </span>
                  <span>
                    {viewerIndex + 1} of {filteredAssets.length}
                  </span>
                  <span>{viewerAsset.title || 'Untitled asset'}</span>
                </p>
              </div>
              <div className="asset-viewer-head-actions">
                <button onClick={() => navigateViewer('previous')} disabled={!canViewPreviousAsset}>
                  Previous
                </button>
                <button onClick={() => navigateViewer('next')} disabled={!canViewNextAsset}>
                  Next
                </button>
                <button onClick={() => void runFindSimilar(viewerAsset.id)} disabled={!hasApiKey}>
                  Find Similar
                </button>
                <button onClick={closeAssetViewer}>Close</button>
              </div>
            </div>

            <div className="asset-viewer-layout">
              <div className="asset-viewer-stage">
                <img
                  src={getAssetOriginalSrc(viewerAsset)}
                  alt={viewerAsset.id}
                  className="asset-viewer-image"
                />
              </div>

              <aside className="asset-viewer-side">
                <div className="asset-viewer-section">
                  <h4>Overview</h4>
                  {detailLoading ? <p>Loading asset detail…</p> : null}
                  <label className="field-label">
                    Title
                    <input
                      value={titleDraft}
                      onChange={(event) => setTitleDraft(event.target.value)}
                      disabled={busy || detailLoading}
                    />
                  </label>
                  <label className="field-label">
                    Note
                    <textarea
                      value={noteDraft}
                      onChange={(event) => setNoteDraft(event.target.value)}
                      rows={4}
                      disabled={busy || detailLoading}
                    />
                  </label>
                  <div className="detail-actions asset-viewer-actions">
                    <button onClick={saveAssetMetadata} disabled={busy || detailLoading}>
                      Save Metadata
                    </button>
                    <button
                      onClick={() => void retryAssets([viewerAsset.id], 'Retry asset')}
                      disabled={busy || !hasApiKey}
                    >
                      {viewerAsset.status === 'failed' ? 'Retry Indexing' : 'Reindex Asset'}
                    </button>
                  </div>
                </div>

                {viewerDetail ? (
                  <div className="asset-viewer-section">
                    <h4>Details</h4>
                    <div className="chip-list">
                      <span className="inline-chip">{viewerDetail.mime}</span>
                      <span className="inline-chip">
                        {viewerDetail.width}×{viewerDetail.height}
                      </span>
                      <span className="inline-chip">{formatFileSize(viewerDetail.fileSizeBytes)}</span>
                      <span className="inline-chip">{viewerDetail.enrichment.orientation}</span>
                      <span className="inline-chip">{viewerDetail.enrichment.aspectBucket}</span>
                      {viewerDetail.enrichment.hasText ? (
                        <span className="inline-chip">has text</span>
                      ) : (
                        <span className="inline-chip">no text</span>
                      )}
                      {viewerDetail.enrichment.dominantColors.map((color) => (
                        <span key={`${viewerDetail.id}-${color}`} className="inline-chip">
                          {formatColorFamilyLabel(color)}
                        </span>
                      ))}
                    </div>
                    <p>Imported {formatCreatedAt(viewerDetail.createdAt)}</p>
                    <p>Source: {formatImportSourceLabel(viewerDetail.importSource)}</p>
                    <p className="asset-viewer-identity">{viewerDetail.id}</p>
                    <p className="asset-viewer-identity">{viewerDetail.checksum}</p>
                    {Object.keys(viewerDetail.enrichment.exif).length > 0 ? (
                      <dl className="meta-pairs">
                        {Object.entries(viewerDetail.enrichment.exif).map(([key, value]) => (
                          <div key={key}>
                            <dt>{key}</dt>
                            <dd>{String(value)}</dd>
                          </div>
                        ))}
                      </dl>
                    ) : (
                      <p>No EXIF metadata detected.</p>
                    )}
                  </div>
                ) : null}

                {viewerDetail ? (
                  <div className="asset-viewer-section">
                    <div className="asset-viewer-section-head">
                      <h4>Suggested Tags</h4>
                      <div className="detail-actions">
                        <button
                          onClick={() =>
                            void acceptSuggestedTags(
                              viewerAsset.id,
                              viewerSuggestedTagSelection.length > 0
                                ? viewerSuggestedTagSelection
                                : viewerPendingSuggestions.map((suggestion) => suggestion.value)
                            )
                          }
                          disabled={busy || viewerPendingSuggestions.length === 0}
                        >
                          {viewerSuggestedTagSelection.length > 0 ? 'Apply Selected' : 'Apply All'}
                        </button>
                        <button
                          onClick={() =>
                            void rejectSuggestedTags(
                              viewerAsset.id,
                              viewerSuggestedTagSelection.length > 0
                                ? viewerSuggestedTagSelection
                                : viewerPendingSuggestions.map((suggestion) => suggestion.value)
                            )
                          }
                          disabled={busy || viewerPendingSuggestions.length === 0}
                        >
                          Dismiss
                        </button>
                      </div>
                    </div>
                    {viewerPendingSuggestions.length > 0 ? (
                      <div className="suggestion-list">
                        {viewerPendingSuggestions.map((suggestion) => {
                          const isSelected = viewerSuggestedTagSelection.includes(suggestion.value);
                          return (
                            <article key={`${viewerDetail.id}-${suggestion.value}`} className="suggestion-row">
                              <label className="suggestion-toggle">
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={() =>
                                    setViewerSuggestedTagSelection((current) =>
                                      current.includes(suggestion.value)
                                        ? current.filter((value) => value !== suggestion.value)
                                        : [...current, suggestion.value]
                                    )
                                  }
                                  disabled={busy}
                                />
                                <div className="suggestion-copy">
                                  <strong>{suggestion.value}</strong>
                                  <span>
                                    {formatSuggestionSource(suggestion.source)} ·{' '}
                                    {Math.round(suggestion.confidence * 100)}%
                                  </span>
                                </div>
                              </label>
                              <div className="suggestion-actions">
                                <button
                                  onClick={() => void acceptSuggestedTags(viewerAsset.id, [suggestion.value])}
                                  disabled={busy}
                                >
                                  Apply
                                </button>
                                <button
                                  onClick={() => void rejectSuggestedTags(viewerAsset.id, [suggestion.value])}
                                  disabled={busy}
                                >
                                  Dismiss
                                </button>
                              </div>
                            </article>
                          );
                        })}
                      </div>
                    ) : (
                      <p>No pending smart tags right now.</p>
                    )}
                    {viewerDismissedSuggestionCount > 0 ? (
                      <p className="reason reason-secondary">
                        {viewerDismissedSuggestionCount} suggestion
                        {viewerDismissedSuggestionCount === 1 ? '' : 's'} dismissed for this extraction.
                      </p>
                    ) : null}
                  </div>
                ) : null}

                {viewerDetail ? (
                  <div className="asset-viewer-section">
                    <div className="asset-viewer-section-head">
                      <h4>Detected Text</h4>
                      <button
                        onClick={() => void rerunEnrichment([viewerAsset.id], 'Re-run enrichment')}
                        disabled={busy || !hasApiKey}
                      >
                        Re-run Enrichment
                      </button>
                    </div>
                    <p className="reason reason-secondary">
                      Updated {formatCreatedAt(viewerDetail.enrichment.updatedAt)} ·{' '}
                      {formatOcrRotation(viewerDetail.enrichment.ocrRotation)}
                    </p>
                    {viewerDetail.enrichment.ocrLines.length > 0 ? (
                      <div className="ocr-lines">
                        {viewerDetail.enrichment.ocrLines.map((line, index) => (
                          <p key={`${viewerDetail.id}-ocr-${index}`}>{line}</p>
                        ))}
                      </div>
                    ) : (
                      <p>No readable text detected for this asset yet.</p>
                    )}
                    {viewerDetail.enrichment.pathTokens.length > 0 ? (
                      <div className="chip-list">
                        {viewerDetail.enrichment.pathTokens.map((token) => (
                          <span key={`${viewerDetail.id}-path-${token}`} className="inline-chip">
                            {token}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                <div className="asset-viewer-section">
                  <h4>Collections</h4>
                  <div className="chip-list">
                    {(viewerDetail?.collectionEntries ?? []).map((collection) => (
                      <span key={collection.id} className="editable-chip">
                        {collection.name}
                        <button
                          onClick={() =>
                            void runAction('Remove collection', async () => {
                              await detachCollection(viewerAsset.id, collection.id);
                            })
                          }
                          disabled={busy}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                  <div className="inline-form">
                    <input
                      value={viewerCollectionInput}
                      onChange={(event) => setViewerCollectionInput(event.target.value)}
                      placeholder="new collection"
                      disabled={busy}
                    />
                    <button onClick={() => void createAndAttachViewerCollection()} disabled={busy}>
                      Add Collection
                    </button>
                  </div>
                  <div className="chip-list">
                    {collections.map((collection) => (
                      <button
                        key={collection.id}
                        onClick={() =>
                          void runAction('Attach collection', async () => {
                            await attachCollection(viewerAsset.id, collection.id);
                          })
                        }
                        disabled={busy}
                      >
                        {collection.name}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="asset-viewer-section">
                  <h4>Tags</h4>
                  <div className="chip-list">
                    {(viewerDetail?.tagEntries ?? []).map((tag) => (
                      <span key={tag.id} className="editable-chip">
                        {tag.name}
                        <button
                          onClick={() =>
                            void runAction('Remove tag', async () => {
                              await detachTag(viewerAsset.id, tag.id);
                            })
                          }
                          disabled={busy}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                  <div className="inline-form">
                    <input
                      value={viewerTagInput}
                      onChange={(event) => setViewerTagInput(event.target.value)}
                      placeholder="new tag"
                      disabled={busy}
                    />
                    <button onClick={() => void createAndAttachViewerTag()} disabled={busy}>
                      Add Tag
                    </button>
                  </div>
                  <div className="chip-list">
                    {tags.map((tag) => (
                      <button
                        key={tag.id}
                        onClick={() =>
                          void runAction('Attach tag', async () => {
                            await attachTag(viewerAsset.id, tag.id);
                          })
                        }
                        disabled={busy}
                      >
                        {tag.name}
                      </button>
                    ))}
                  </div>
                </div>

                {viewerDetail ? (
                  <div className="asset-viewer-section">
                    <h4>Retrieval Signals</h4>
                    {searchResults[viewerAsset.id] ? (
                      <>
                        <div className="chip-list">
                          {searchResults[viewerAsset.id].reasons.map((reason) => (
                            <span key={`${viewerAsset.id}-${reason}`} className="inline-chip">
                              {reason}
                            </span>
                          ))}
                        </div>
                        <p>
                          {formatExplanationSummary(searchResults[viewerAsset.id].explanation).join(
                            ' · '
                          )}
                        </p>
                        <p>{searchResults[viewerAsset.id].explanation.snippet}</p>
                      </>
                    ) : (
                      <p>No active ranked search for this asset right now.</p>
                    )}
                    <p>{viewerDetail.retrievalCaption}</p>
                  </div>
                ) : null}

                {viewerDetail ? (
                  <div className="asset-viewer-section">
                    <h4>Search document</h4>
                    <div className="search-document-list">
                      {viewerDetail.searchDocumentSections.map((section) => (
                        <article
                          key={`${viewerDetail.id}-${section.section}`}
                          className="search-document-section"
                        >
                          <strong>{section.section}</strong>
                          <p>{section.content}</p>
                        </article>
                      ))}
                    </div>
                  </div>
                ) : null}
              </aside>
            </div>
          </section>
        </div>
      ) : null}

      {showJobs ? (
        <div className="settings-backdrop" onClick={() => setShowJobs(false)}>
          <section
            className="settings-panel panel jobs-overlay"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="settings-head">
              <h3>Index Jobs</h3>
              <button onClick={() => setShowJobs(false)}>Close</button>
            </div>

            <div className="jobs-summary-grid">
              <article className="jobs-summary-card">
                <strong>{runningJobs}</strong>
                <span>Active now</span>
              </article>
              <article className="jobs-summary-card">
                <strong>{failedJobCount}</strong>
                <span>Needs retry</span>
              </article>
              <article className="jobs-summary-card">
                <strong>{recentSuccessfulJobs.length}</strong>
                <span>Recent success</span>
              </article>
            </div>

            <div className="jobs-toolbar">
              <button
                onClick={() =>
                  void retryAssets(
                    failedJobs.map((job) => job.assetId),
                    'Retry failed assets'
                  )
                }
                disabled={busy || !hasApiKey || failedJobCount === 0}
              >
                Retry Failed
              </button>
              <button
                onClick={() =>
                  selectedAssetIds.length > 0
                    ? void retryAssets(selectedAssetIds, 'Retry selected assets')
                    : setMessage('Select assets first')
                }
                disabled={busy || !hasApiKey || selectedAssetIds.length === 0}
              >
                Retry Selection
              </button>
              <button
                onClick={() =>
                  void runAction('Refresh status', async () => {
                    await refresh();
                  })
                }
                disabled={busy}
              >
                Refresh Status
              </button>
            </div>

            <div className="jobs-sections">
              <section className="jobs-section">
                <div className="jobs-section-head">
                  <h4>Queue</h4>
                  <span>{runningJobs === 0 ? 'Idle' : `${runningJobs} active`}</span>
                </div>
                {activeJobs.length === 0 ? (
                  <p className="jobs-empty">Nothing is queued or running.</p>
                ) : (
                  <div className="jobs-list">
                    {activeJobs.map((job) => {
                      const asset = assetMap.get(job.assetId) ?? null;
                      return (
                        <article className="job-row" key={`${job.assetId}-${job.stage}`}>
                          <div className="job-row-main">
                            <div className="job-title-line">
                              <span className={`status-pill status-${job.status}`}>
                                {job.status}
                              </span>
                              <strong>{formatAssetLabel(asset)}</strong>
                            </div>
                            <p className="job-meta">
                              <span className="mono-text">{job.assetId.slice(0, 12)}</span>
                              <span>{job.stage}</span>
                              <span>{formatJobUpdatedAt(job.updatedAt)}</span>
                            </p>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                )}
              </section>

              <section className="jobs-section">
                <div className="jobs-section-head">
                  <h4>Needs attention</h4>
                  <span>{failedJobCount === 0 ? 'Clear' : `${failedJobCount} failed`}</span>
                </div>
                {failedJobs.length === 0 ? (
                  <p className="jobs-empty">No failed assets right now.</p>
                ) : (
                  <div className="jobs-list">
                    {failedJobs.map((job) => {
                      const asset = assetMap.get(job.assetId) ?? null;
                      return (
                        <article
                          className="job-row job-row-failed"
                          key={`${job.assetId}-${job.stage}`}
                        >
                          <div className="job-row-main">
                            <div className="job-title-line">
                              <span className={`status-pill status-${job.status}`}>
                                {job.status}
                              </span>
                              <strong>{formatAssetLabel(asset)}</strong>
                            </div>
                            <p className="job-meta">
                              <span className="mono-text">{job.assetId.slice(0, 12)}</span>
                              <span>{job.stage}</span>
                              <span>{formatJobUpdatedAt(job.updatedAt)}</span>
                            </p>
                            <p className="job-error">{summarizeJobError(job.error)}</p>
                          </div>
                          <button
                            onClick={() => void retryAssets([job.assetId], 'Retry failed asset')}
                            disabled={busy || !hasApiKey}
                          >
                            Retry
                          </button>
                        </article>
                      );
                    })}
                  </div>
                )}
              </section>

              {recentSuccessfulJobs.length > 0 ? (
                <section className="jobs-section">
                  <div className="jobs-section-head">
                    <h4>Recent success</h4>
                    <span>{recentSuccessfulJobs.length} shown</span>
                  </div>
                  <div className="jobs-list">
                    {recentSuccessfulJobs.map((job) => {
                      const asset = assetMap.get(job.assetId) ?? null;
                      return (
                        <article
                          className="job-row job-row-success"
                          key={`${job.assetId}-${job.stage}`}
                        >
                          <div className="job-row-main">
                            <div className="job-title-line">
                              <span className={`status-pill status-${job.status}`}>
                                {job.status}
                              </span>
                              <strong>{formatAssetLabel(asset)}</strong>
                            </div>
                            <p className="job-meta">
                              <span className="mono-text">{job.assetId.slice(0, 12)}</span>
                              <span>{job.stage}</span>
                              <span>{formatJobUpdatedAt(job.updatedAt)}</span>
                            </p>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </section>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}

      {showSettings ? (
        <div className="settings-backdrop" onClick={() => setShowSettings(false)}>
          <section className="settings-panel panel" onClick={(event) => event.stopPropagation()}>
            <div className="settings-head">
              <h3>Settings</h3>
              <button onClick={() => setShowSettings(false)}>Close</button>
            </div>

            <div className="api-panel">
              <strong>Gemini API Key</strong>
              <span>{hasApiKey ? 'Saved in macOS Keychain' : 'Not configured'}</span>
              <span>
                Embedding model: <span className="mono-text">{apiModel}</span>
              </span>
              <input
                type="password"
                value={apiKeyInput}
                onChange={(event) => setApiKeyInput(event.target.value)}
                placeholder="Paste Gemini API key"
                disabled={busy}
              />
              <button onClick={saveApiKey} disabled={busy}>
                Save Key
              </button>
              <button onClick={clearApiKey} disabled={busy || !hasApiKey}>
                Clear Key
              </button>
            </div>

            <div className="settings-actions">
              <button onClick={() => void api.pauseIndexing()} disabled={busy}>
                Pause Indexing
              </button>
              <button onClick={() => void api.resumeIndexing()} disabled={busy}>
                Resume Indexing
              </button>
              <button
                onClick={() => void api.reindex().then(refresh)}
                disabled={busy || !hasApiKey}
              >
                Reindex All
              </button>
              <button
                onClick={() =>
                  void runAction('Network mode update', async () => {
                    const next = !online;
                    await api.setNetworkState(next);
                    setOnline(next);
                    setMessage(next ? 'Online mode enabled' : 'Offline mode enabled');
                  })
                }
                disabled={busy}
              >
                {online ? 'Go Offline' : 'Go Online'}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
};
