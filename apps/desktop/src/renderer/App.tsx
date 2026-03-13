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

type Job = {
  assetId: string;
  stage: string;
  status: string;
  error: string | null;
  updatedAt: string;
};

export const App = () => {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [search, setSearch] = useState('');
  const [searchMode, setSearchMode] = useState<'semantic' | 'similar-image'>('semantic');
  const [searchResults, setSearchResults] = useState<
    Record<string, { score: number; reasons: string[] }>
  >({});
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);
  const [message, setMessage] = useState('Ready');
  const [tags, setTags] = useState<Array<{ id: string; name: string }>>([]);
  const [collections, setCollections] = useState<Array<{ id: string; name: string }>>([]);
  const [tagInput, setTagInput] = useState('');
  const [collectionInput, setCollectionInput] = useState('');
  const [mimeFilter, setMimeFilter] = useState('');
  const [online, setOnline] = useState(true);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [hasApiKey, setHasApiKey] = useState(false);

  const refresh = useCallback(async () => {
    const [assetRows, jobRows, tagRows, collectionRows, networkState, apiSettings] = await Promise.all([
      window.vectorSpace.listAssets(),
      window.vectorSpace.listJobs(),
      window.vectorSpace.listTags(),
      window.vectorSpace.listCollections(),
      window.vectorSpace.getNetworkState(),
      window.vectorSpace.getApiSettings()
    ]);
    setAssets(assetRows as Asset[]);
    setJobs(jobRows as Job[]);
    setTags(tagRows);
    setCollections(collectionRows);
    setOnline(networkState.online);
    setHasApiKey(apiSettings.hasApiKey);

    if (selectedAsset) {
      const current = (assetRows as Asset[]).find((asset) => asset.id === selectedAsset.id) ?? null;
      setSelectedAsset(current);
    }
  }, [selectedAsset]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      void refresh();
    }, 2000);

    const onPaste = async (event: ClipboardEvent) => {
      if (!event.clipboardData) return;
      const hasImage = Array.from(event.clipboardData.items).some((item) =>
        item.type.startsWith('image/')
      );
      if (hasImage) {
        const result = await window.vectorSpace.importClipboard();
        setMessage(`Clipboard import: ${result.imported} imported, ${result.skipped} skipped`);
        await refresh();
      }
    };

    document.addEventListener('paste', onPaste);
    return () => {
      clearInterval(timer);
      document.removeEventListener('paste', onPaste);
    };
  }, [refresh]);

  const onImportFiles = async () => {
    const files = await window.vectorSpace.openFileDialog();
    if (!files.length) return;
    const result = await window.vectorSpace.importFiles(files);
    setMessage(`Imported ${result.imported}, skipped ${result.skipped}`);
    await refresh();
  };

  const onImportFolder = async () => {
    const folder = await window.vectorSpace.openFolderDialog();
    if (!folder) return;
    const result = await window.vectorSpace.importFolder(folder);
    setMessage(`Folder import: ${result.imported}, skipped ${result.skipped}`);
    await refresh();
  };

  const onDrop: React.DragEventHandler<HTMLElement> = async (event) => {
    event.preventDefault();
    const files = Array.from(event.dataTransfer.files).map(
      (file) => (file as File & { path?: string }).path ?? ''
    );
    const validFiles = files.filter((item) => item.length > 0);
    if (!validFiles.length) return;
    const result = await window.vectorSpace.importFiles(validFiles);
    setMessage(`Drag/drop import: ${result.imported}, skipped ${result.skipped}`);
    await refresh();
  };

  const runSearch = async () => {
    if (!search.trim()) {
      setSearchResults({});
      return;
    }

    const rows =
      searchMode === 'semantic'
        ? await window.vectorSpace.searchText(search)
        : await window.vectorSpace.searchImage(search);

    const mapped: Record<string, { score: number; reasons: string[] }> = {};
    rows.forEach((row) => {
      mapped[row.assetId] = { score: row.score, reasons: row.reasons };
    });

    setSearchResults(mapped);
    setMessage(`Search returned ${rows.length} results`);
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
    if (!apiKeyInput.trim()) return;
    const response = await window.vectorSpace.setApiKey(apiKeyInput.trim());
    setHasApiKey(response.hasApiKey);
    setApiKeyInput('');
    setMessage('Gemini API key saved to macOS Keychain');
  };

  const clearApiKey = async () => {
    await window.vectorSpace.clearApiKey();
    setHasApiKey(false);
    setMessage('Gemini API key removed from macOS Keychain');
  };

  const attachTag = async (tagId: string) => {
    if (!selectedAsset) return;
    await window.vectorSpace.attachTag(selectedAsset.id, tagId);
    await refresh();
  };

  const attachCollection = async (collectionId: string) => {
    if (!selectedAsset) return;
    await window.vectorSpace.attachCollection(selectedAsset.id, collectionId);
    await refresh();
  };

  return (
    <main className="app-shell" onDragOver={(event) => event.preventDefault()} onDrop={onDrop}>
      <header>
        <h1>{window.vectorSpace.appName}</h1>
        <p>{message}</p>
      </header>

      <section className="controls">
        <div className="api-panel">
          <strong>Gemini API Key</strong>
          <span>{hasApiKey ? 'Saved in macOS Keychain' : 'Not configured'}</span>
          <input
            type="password"
            value={apiKeyInput}
            onChange={(event) => setApiKeyInput(event.target.value)}
            placeholder="Paste Gemini API key"
          />
          <button onClick={saveApiKey}>Save Key</button>
          <button onClick={clearApiKey}>Clear Key</button>
        </div>
        <button onClick={onImportFiles}>Import Files</button>
        <button onClick={onImportFolder}>Import Folder</button>
        <button onClick={() => void window.vectorSpace.importClipboard().then(refresh)}>
          Paste from Clipboard
        </button>
        <button onClick={() => void window.vectorSpace.pauseIndexing()}>Pause Indexing</button>
        <button onClick={() => void window.vectorSpace.resumeIndexing()}>Resume Indexing</button>
        <button onClick={() => void window.vectorSpace.reindex().then(refresh)}>Reindex All</button>
        <button
          onClick={async () => {
            const next = !online;
            await window.vectorSpace.setNetworkState(next);
            setOnline(next);
          }}
        >
          {online ? 'Go Offline' : 'Go Online'}
        </button>
      </section>

      <section className="search">
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Semantic query or image path"
        />
        <select
          value={searchMode}
          onChange={(event) => setSearchMode(event.target.value as 'semantic' | 'similar-image')}
        >
          <option value="semantic">Semantic</option>
          <option value="similar-image">Similar Image</option>
        </select>
        <input
          placeholder="Filter mime (ex image/)"
          value={mimeFilter}
          onChange={(event) => setMimeFilter(event.target.value)}
        />
        <button onClick={runSearch}>Search</button>
      </section>

      <section className="content">
        <aside>
          <h3>Index Jobs</h3>
          <ul>
            {jobs.slice(0, 8).map((job) => (
              <li key={`${job.assetId}-${job.updatedAt}`}>
                <b>{job.status}</b> {job.assetId.slice(0, 8)} {job.error ? `(${job.error})` : ''}
              </li>
            ))}
          </ul>
        </aside>

        <section className="grid">
          {filteredAssets.map((asset) => (
            <article key={asset.id} className="card" onClick={() => setSelectedAsset(asset)}>
              {asset.thumbnailPath ? (
                <img src={`file://${asset.thumbnailPath}`} alt={asset.id} />
              ) : (
                <div className="placeholder" />
              )}
              <div>
                <strong>{asset.id.slice(0, 8)}</strong>
                <p>
                  {asset.width}×{asset.height} · {asset.status}
                </p>
                {searchResults[asset.id] ? (
                  <p className="reason">Why: {searchResults[asset.id]?.reasons.join(', ')}</p>
                ) : null}
              </div>
            </article>
          ))}
        </section>

        <aside>
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
                />
                <button
                  onClick={async () => {
                    const response = await window.vectorSpace.createTag(tagInput);
                    await attachTag(response.id);
                    setTagInput('');
                  }}
                >
                  Add Tag
                </button>
              </div>

              <div className="inline-form">
                <input
                  value={collectionInput}
                  onChange={(event) => setCollectionInput(event.target.value)}
                  placeholder="new collection"
                />
                <button
                  onClick={async () => {
                    const response = await window.vectorSpace.createCollection(collectionInput);
                    await attachCollection(response.id);
                    setCollectionInput('');
                  }}
                >
                  Add Collection
                </button>
              </div>

              <div>
                <h4>Attach existing</h4>
                {tags.map((tag) => (
                  <button key={tag.id} onClick={() => void attachTag(tag.id)}>
                    {tag.name}
                  </button>
                ))}
                {collections.map((collection) => (
                  <button key={collection.id} onClick={() => void attachCollection(collection.id)}>
                    {collection.name}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <p>Select an asset card.</p>
          )}
        </aside>
      </section>
    </main>
  );
};
