import { useCallback, useEffect, useMemo, useState } from 'react';

type Asset = {
  id: string;
  createdAt: string;
  mime: string;
  width: number;
  height: number;
  status: 'imported' | 'indexing' | 'ready' | 'failed';
  thumbnailPath: string | null;
  originalPath: string;
  tags: string[];
  collections: string[];
};

type VectorSpaceApi = Window['vectorSpace'];

type Job = {
  assetId: string;
  stage: string;
  status: string;
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
    searchText: async () => [],
    searchImage: async () => [],
    getNetworkState: async () => ({ online: true }),
    setNetworkState: async (nextOnline: boolean) => ({ online: nextOnline }),
    getApiSettings: async () => ({ hasApiKey: true, model: 'gemini-embedding-001' }),
    setApiKey: async () => ({ hasApiKey: true }),
    clearApiKey: async () => ({ hasApiKey: false })
  };
};

export const App = () => {
  const api = useMemo(
    () => (window as Window & { vectorSpace?: VectorSpaceApi }).vectorSpace ?? createPreviewApi(),
    []
  );
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

  const getAssetLabel = (asset: Asset) => {
    const parts = asset.originalPath.split(/[/\\]/);
    return (parts.at(-1) ?? asset.id).toUpperCase();
  };

  const runningJobs = jobs.filter(
    (job) => job.status === 'running' || job.status === 'queued'
  ).length;
  const failedJobs = jobs.filter((job) => job.status === 'failed' || Boolean(job.error)).length;
  const jobPillLabel =
    runningJobs > 0
      ? `Jobs ${runningJobs} running`
      : failedJobs > 0
        ? `Jobs ${failedJobs} failed`
        : `Jobs ${jobs.length}`;

  const getAssetImageSrc = (asset: Asset) => {
    if (!asset.thumbnailPath) {
      return null;
    }

    return asset.thumbnailPath.startsWith('data:')
      ? asset.thumbnailPath
      : `file://${asset.thumbnailPath}`;
  };

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
              >
                {imageSrc ? <img src={imageSrc} alt={asset.id} /> : <div className="placeholder" />}
                <div className="card-meta">
                  <strong className="asset-name">{getAssetLabel(asset)}</strong>
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
              <p>{selectedAsset.id}</p>
              <p>{selectedAsset.mime}</p>
              <p>Tags: {selectedAsset.tags.join(', ') || 'none'}</p>
              <p>Collections: {selectedAsset.collections.join(', ') || 'none'}</p>

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

              <div className="attach-group">
                <h4>Attach existing</h4>
                <div className="chip-list">
                  {tags.map((tag) => (
                    <button key={tag.id} onClick={() => void attachTag(tag.id)} disabled={busy}>
                      {tag.name}
                    </button>
                  ))}
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
            </>
          ) : (
            <p>Select an asset card.</p>
          )}
        </aside>
      </section>

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
            <ul>
              {jobs.length === 0 ? (
                <li>No indexing jobs yet.</li>
              ) : (
                jobs.slice(0, 20).map((job) => (
                  <li key={`${job.assetId}-${job.updatedAt}`}>
                    <b>{job.status}</b> · {job.stage} ·{' '}
                    <span className="mono-text">{job.assetId.slice(0, 12)}</span>{' '}
                    {job.error ? `(${job.error})` : ''}
                  </li>
                ))
              )}
            </ul>
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
