import { useCallback, useEffect, useMemo, useState } from 'react';
import { GEMINI_EMBEDDING_MODEL, getGeminiApiSettings } from '../shared/gemini';
import {
  getAdjacentViewerAssetId,
  getViewerAssetIndex,
  shouldBlockViewerKeyboardNavigation,
  viewerAssetStillVisible
} from './assetViewer';
import { buildLibraryAssetUrl, buildThumbnailSrc } from './assetUrls';

type Asset = {
  id: string;
  createdAt: string;
  mime: string;
  width: number;
  height: number;
  status: 'imported' | 'indexing' | 'ready' | 'failed';
  thumbnailPath: string | null;
  thumbnailUpdatedAt: string | null;
  originalPath: string;
  tags: string[];
  collections: string[];
};

type VectorSpaceApi = Window['vectorSpace'];

type Job = {
  assetId: string;
  stage: string;
  status: 'queued' | 'running' | 'success' | 'failed';
  error: string | null;
  updatedAt: string;
};

const statusLabel: Record<Asset['status'], string> = {
  imported: 'Imported',
  indexing: 'Indexing',
  ready: 'Ready',
  failed: 'Failed'
};

const parseErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }

  return 'Unexpected error';
};

const formatAssetLabel = (asset: Asset | null) => {
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

const createPreviewApi = (): VectorSpaceApi => {
  const demoAssets: Asset[] = Array.from({ length: 48 }, (_, index) => {
    const palette = previewPalettes[index % previewPalettes.length];
    const sequence = String(index + 1).padStart(4, '0');
    const width = [1024, 1280, 960, 1440, 800, 1080][index % 6];
    const height = [1024, 720, 1280, 900, 1200, 1080][index % 6];
    const status: Asset['status'] = index % 11 === 0 ? 'indexing' : 'ready';

    return {
      id: `demo-${sequence}`,
      createdAt: new Date(Date.now() - index * 3_600_000).toISOString(),
      mime: 'image/png',
      width,
      height,
      status,
      thumbnailPath: createPreviewThumb(`DEMO ${index + 1}`, palette),
      thumbnailUpdatedAt: new Date(Date.now() - index * 3_600_000).toISOString(),
      originalPath: `/demo/color-study-${sequence}.png`,
      tags: index % 2 === 0 ? ['color'] : ['demo'],
      collections: index % 3 === 0 ? ['showcase'] : ['seed']
    };
  });

  return {
    appName: 'Vector Space Library (Preview Mode)',
    listAssets: async () => demoAssets,
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
    listTags: async () => [
      { id: 'tag-color', name: 'color' },
      { id: 'tag-demo', name: 'demo' }
    ],
    listCollections: async () => [
      { id: 'col-showcase', name: 'showcase' },
      { id: 'col-seed', name: 'seed' }
    ],
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
    pauseIndexing: async () => ({ ok: true }),
    resumeIndexing: async () => ({ ok: true }),
    reindex: async () => ({ ok: true }),
    retryAssets: async () => ({ ok: true }),
    searchText: async () => [],
    searchImage: async () => [],
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

export const App = () => {
  const api = useMemo(() => getRendererApi(), []);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [search, setSearch] = useState('');
  const [searchMode, setSearchMode] = useState<'semantic' | 'similar-image'>('semantic');
  const [searchResults, setSearchResults] = useState<
    Record<string, { score: number; reasons: string[] }>
  >({});
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [message, setMessage] = useState('Ready');
  const [busy, setBusy] = useState(false);
  const [tags, setTags] = useState<Array<{ id: string; name: string }>>([]);
  const [collections, setCollections] = useState<Array<{ id: string; name: string }>>([]);
  const [tagInput, setTagInput] = useState('');
  const [collectionInput, setCollectionInput] = useState('');
  const [mimeFilter, setMimeFilter] = useState('');
  const [online, setOnline] = useState(true);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [hasApiKey, setHasApiKey] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showJobs, setShowJobs] = useState(false);
  const [viewerAssetId, setViewerAssetId] = useState<string | null>(null);
  const [apiModel, setApiModel] = useState<string>(GEMINI_EMBEDDING_MODEL);

  const selectedAsset = useMemo(
    () => assets.find((asset) => asset.id === selectedAssetId) ?? null,
    [assets, selectedAssetId]
  );

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
    const [assetRows, jobRows, tagRows, collectionRows, networkState, apiSettings] =
      await Promise.all([
        api.listAssets(),
        api.listJobs(),
        api.listTags(),
        api.listCollections(),
        api.getNetworkState(),
        api.getApiSettings()
      ]);

    setAssets(assetRows as Asset[]);
    setJobs(jobRows as Job[]);
    setTags(tagRows);
    setCollections(collectionRows);
    setOnline(networkState.online);
    setHasApiKey(apiSettings.hasApiKey);
    setApiModel(apiSettings.model);
  }, [api]);

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

  const runSearch = async () => {
    await runAction('Search', async () => {
      if (!search.trim()) {
        setSearchResults({});
        setMessage('Search cleared');
        return;
      }

      const rows =
        searchMode === 'semantic' ? await api.searchText(search) : await api.searchImage(search);

      const mapped: Record<string, { score: number; reasons: string[] }> = {};
      rows.forEach((row: { assetId: string; score: number; reasons: string[] }) => {
        mapped[row.assetId] = { score: row.score, reasons: row.reasons };
      });

      setSearchResults(mapped);
      setMessage(`Search returned ${rows.length} results`);
    });
  };

  const filteredAssets = useMemo(() => {
    let working = [...assets];

    if (mimeFilter) {
      working = working.filter((asset) => asset.mime.includes(mimeFilter));
    }

    if (Object.keys(searchResults).length > 0) {
      working = working
        .filter((asset) => Boolean(searchResults[asset.id]))
        .sort((a, b) => (searchResults[b.id]?.score ?? 0) - (searchResults[a.id]?.score ?? 0));
    }

    return working;
  }, [assets, mimeFilter, searchResults]);

  const assetMap = useMemo(() => new Map(assets.map((asset) => [asset.id, asset])), [assets]);

  const viewerAsset = useMemo(
    () => (viewerAssetId ? assetMap.get(viewerAssetId) ?? null : null),
    [assetMap, viewerAssetId]
  );

  const viewerIndex = useMemo(
    () => getViewerAssetIndex(viewerAssetId, filteredAssets),
    [filteredAssets, viewerAssetId]
  );

  const canViewPreviousAsset = viewerIndex > 0;
  const canViewNextAsset = viewerIndex !== -1 && viewerIndex < filteredAssets.length - 1;

  const openAssetViewer = useCallback((assetId: string) => {
    setSelectedAssetId(assetId);
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

      setSelectedAssetId(nextAssetId);
      setViewerAssetId(nextAssetId);
    },
    [filteredAssets, viewerAssetId]
  );

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

  const attachTag = async (tagId: string) => {
    if (!selectedAsset) return;
    await api.attachTag(selectedAsset.id, tagId);
    await refresh();
  };

  const attachCollection = async (collectionId: string) => {
    if (!selectedAsset) return;
    await api.attachCollection(selectedAsset.id, collectionId);
    await refresh();
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

  const getAssetImageSrc = (asset: Asset) => {
    return buildThumbnailSrc(asset);
  };

  const getAssetOriginalSrc = (asset: Asset) => {
    if (asset.originalPath.startsWith('data:')) {
      return asset.originalPath;
    }

    const maybePreviewFallback = asset.thumbnailPath?.startsWith('data:') ? asset.thumbnailPath : null;
    const hasRendererApi = Boolean((window as Window & { vectorSpace?: VectorSpaceApi }).vectorSpace);

    if (!hasRendererApi && maybePreviewFallback) {
      return maybePreviewFallback;
    }

    return buildLibraryAssetUrl(asset.originalPath);
  };

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

  return (
    <main className="app-shell" onDragOver={(event) => event.preventDefault()} onDrop={onDrop}>
      <header className="app-header">
        <div className="title-wrap">
          <h1>Your library</h1>
        </div>
        <div className="header-actions">
          <p className="message-pill">{message}</p>
          <button className="jobs-pill" onClick={() => setShowJobs(true)} disabled={busy}>
            {jobPillLabel}
          </button>
          <button className="settings-btn" onClick={() => setShowSettings(true)} disabled={busy}>
            Settings
          </button>
        </div>
      </header>

      <section className="toolbar panel">
        <div className="toolbar-group toolbar-line">
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
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Semantic query or image path"
            disabled={busy}
          />
          <select
            value={searchMode}
            onChange={(event) => setSearchMode(event.target.value as 'semantic' | 'similar-image')}
            disabled={busy}
          >
            <option value="semantic">Semantic</option>
            <option value="similar-image">Similar Image</option>
          </select>
          <input
            placeholder="Filter mime (ex image/)"
            value={mimeFilter}
            onChange={(event) => setMimeFilter(event.target.value)}
            disabled={busy}
          />
          <button onClick={runSearch} disabled={busy || !hasApiKey}>
            Search
          </button>
        </div>
      </section>

      <section className="content">
        <section className="grid">
          {filteredAssets.map((asset) => {
            const imageSrc = getAssetImageSrc(asset);
            return (
              <article
                key={asset.id}
                className={`card ${selectedAssetId === asset.id ? 'card-selected' : ''}`}
                onClick={() => setSelectedAssetId(asset.id)}
                onDoubleClick={() => openAssetViewer(asset.id)}
              >
                <div className="card-media">
                  {imageSrc ? <img src={imageSrc} alt={asset.id} /> : <div className="placeholder" />}
                </div>
                <div className="card-meta">
                  <strong className="asset-name">{formatAssetLabel(asset)}</strong>
                  <p className="asset-dimensions">
                    <span className="asset-badge">{asset.mime.split('/')[0]}</span>
                    {asset.width}×{asset.height} ·{' '}
                    <span className={`status-pill status-${asset.status}`}>
                      {statusLabel[asset.status]}
                    </span>
                  </p>
                  {searchResults[asset.id] ? (
                    <p className="reason">Why: {searchResults[asset.id]?.reasons.join(', ')}</p>
                  ) : null}
                </div>
              </article>
            );
          })}
        </section>

        <aside className="panel side-panel detail-panel">
          <h3>Asset Detail</h3>
          {selectedAsset ? (
            <>
              <div className="detail-preview">
                {getAssetImageSrc(selectedAsset) ? (
                  <img src={getAssetImageSrc(selectedAsset) ?? ''} alt={selectedAsset.id} />
                ) : (
                  <div className="placeholder" />
                )}
              </div>
              <p className="detail-name">{formatAssetLabel(selectedAsset)}</p>
              <p>
                Status:{' '}
                <span className={`status-pill status-${selectedAsset.status}`}>
                  {statusLabel[selectedAsset.status]}
                </span>
              </p>
              <p>{selectedAsset.mime}</p>
              <p>
                {selectedAsset.width}×{selectedAsset.height} · Imported {formatCreatedAt(selectedAsset.createdAt)}
              </p>
              <p>Tags: {selectedAsset.tags.join(', ') || 'none'}</p>
              <p>Collections: {selectedAsset.collections.join(', ') || 'none'}</p>

              <div className="detail-actions">
                <button onClick={() => openAssetViewer(selectedAsset.id)} disabled={busy}>
                  View Asset
                </button>
              </div>
              <p className="detail-hint">Double-click any asset card to enter the full viewer.</p>
            </>
          ) : (
            <p>Select an asset card.</p>
          )}
        </aside>
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
                </p>
              </div>
              <div className="asset-viewer-head-actions">
                <button onClick={() => navigateViewer('previous')} disabled={!canViewPreviousAsset}>
                  Previous
                </button>
                <button onClick={() => navigateViewer('next')} disabled={!canViewNextAsset}>
                  Next
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
                  <p className="asset-viewer-identity">{viewerAsset.id}</p>
                  <p>{viewerAsset.mime}</p>
                  <p>{viewerAsset.width}×{viewerAsset.height}</p>
                  <p>Imported {formatCreatedAt(viewerAsset.createdAt)}</p>
                  <p>
                    Status:{' '}
                    <span className={`status-pill status-${viewerAsset.status}`}>
                      {statusLabel[viewerAsset.status]}
                    </span>
                  </p>
                </div>

                <div className="asset-viewer-section">
                  <h4>Actions</h4>
                  <div className="detail-actions asset-viewer-actions">
                    <button
                      onClick={() => void retryAssets([viewerAsset.id], 'Retry asset')}
                      disabled={busy || !hasApiKey}
                    >
                      {viewerAsset.status === 'failed' ? 'Retry Indexing' : 'Reindex Asset'}
                    </button>
                  </div>
                </div>

                <div className="asset-viewer-section">
                  <h4>Tags</h4>
                  <p>{viewerAsset.tags.join(', ') || 'none'}</p>
                  <div className="inline-form">
                    <input
                      value={tagInput}
                      onChange={(event) => setTagInput(event.target.value)}
                      placeholder="new tag"
                      disabled={busy}
                    />
                    <button
                      onClick={() =>
                        void runAction('Add tag', async () => {
                          if (!tagInput.trim()) {
                            setMessage('Tag name cannot be empty');
                            return;
                          }

                          const response = await api.createTag(tagInput.trim());
                          await attachTag(response.id);
                          setTagInput('');
                          setMessage('Tag attached');
                        })
                      }
                      disabled={busy}
                    >
                      Add Tag
                    </button>
                  </div>
                  <div className="chip-list">
                    {tags.map((tag) => (
                      <button key={tag.id} onClick={() => void attachTag(tag.id)} disabled={busy}>
                        {tag.name}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="asset-viewer-section">
                  <h4>Collections</h4>
                  <p>{viewerAsset.collections.join(', ') || 'none'}</p>
                  <div className="inline-form">
                    <input
                      value={collectionInput}
                      onChange={(event) => setCollectionInput(event.target.value)}
                      placeholder="new collection"
                      disabled={busy}
                    />
                    <button
                      onClick={() =>
                        void runAction('Add collection', async () => {
                          if (!collectionInput.trim()) {
                            setMessage('Collection name cannot be empty');
                            return;
                          }

                          const response = await api.createCollection(collectionInput.trim());
                          await attachCollection(response.id);
                          setCollectionInput('');
                          setMessage('Collection attached');
                        })
                      }
                      disabled={busy}
                    >
                      Add Collection
                    </button>
                  </div>
                  <div className="chip-list">
                    {collections.map((collection) => (
                      <button
                        key={collection.id}
                        onClick={() => void attachCollection(collection.id)}
                        disabled={busy}
                      >
                        {collection.name}
                      </button>
                    ))}
                  </div>
                </div>
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
                  selectedAsset
                    ? void retryAssets([selectedAsset.id], 'Retry selected asset')
                    : setMessage('Select an asset first')
                }
                disabled={busy || !hasApiKey || !selectedAsset}
              >
                Retry Selected
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
                        <article className="job-row job-row-failed" key={`${job.assetId}-${job.stage}`}>
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
                        <article className="job-row job-row-success" key={`${job.assetId}-${job.stage}`}>
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
