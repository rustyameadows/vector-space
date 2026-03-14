import Database from 'better-sqlite3';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { collapseIndexJobHistory, collectInterruptedJobRowIds } from '../jobs/jobState';
import type {
  AppAssetView,
  AssetDetailView,
  AssetEnrichmentView,
  AssetRecord,
  AssetStatus,
  SavedSearchPayload,
  SavedSearchView,
  EmbeddingRecord,
  EmbeddingRole,
  IndexJobView
} from '../types/domain';
import type {
  AssetCollectionView,
  AssetTagView,
  DominantColorFamily
} from '../../shared/contracts';
import { deriveAspectBucket, deriveOrientation } from '../../shared/assetMetadata';

const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS assets (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    import_source TEXT NOT NULL,
    mime TEXT NOT NULL,
    width INTEGER NOT NULL,
    height INTEGER NOT NULL,
    checksum TEXT NOT NULL,
    status TEXT NOT NULL,
    source_path TEXT NOT NULL,
    source_url TEXT,
    title TEXT NOT NULL DEFAULT '',
    user_note TEXT NOT NULL DEFAULT '',
    retrieval_caption TEXT NOT NULL DEFAULT '',
    metadata_json TEXT NOT NULL DEFAULT '{}'
  );`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_assets_checksum ON assets(checksum);`,
  `CREATE TABLE IF NOT EXISTS asset_files (
    id TEXT PRIMARY KEY,
    asset_id TEXT NOT NULL,
    role TEXT NOT NULL,
    local_path TEXT NOT NULL,
    size INTEGER NOT NULL,
    format TEXT NOT NULL,
    FOREIGN KEY(asset_id) REFERENCES assets(id)
  );`,
  `CREATE TABLE IF NOT EXISTS thumbnails (
    asset_id TEXT NOT NULL,
    variant TEXT NOT NULL,
    local_path TEXT NOT NULL,
    width INTEGER NOT NULL,
    height INTEGER NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY(asset_id, variant),
    FOREIGN KEY(asset_id) REFERENCES assets(id)
  );`,
  `CREATE TABLE IF NOT EXISTS embeddings (
    id TEXT PRIMARY KEY,
    asset_id TEXT NOT NULL,
    role TEXT NOT NULL,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    task_type TEXT NOT NULL,
    vector_dim INTEGER NOT NULL,
    vector_blob TEXT NOT NULL,
    created_at TEXT NOT NULL,
    preprocessing_version INTEGER NOT NULL,
    extraction_version INTEGER NOT NULL,
    ocr_version INTEGER NOT NULL,
    embedding_version TEXT NOT NULL,
    FOREIGN KEY(asset_id) REFERENCES assets(id)
  );`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_embeddings_unique_role_version
    ON embeddings(asset_id, role, provider, model, embedding_version);`,
  `CREATE TABLE IF NOT EXISTS asset_text_chunks (
    id TEXT PRIMARY KEY,
    asset_id TEXT NOT NULL,
    chunk_index INTEGER NOT NULL,
    section TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY(asset_id) REFERENCES assets(id)
  );`,
  `CREATE INDEX IF NOT EXISTS idx_asset_text_chunks_asset_id ON asset_text_chunks(asset_id);`,
  `CREATE TABLE IF NOT EXISTS asset_enrichments (
    asset_id TEXT PRIMARY KEY,
    ocr_text TEXT NOT NULL DEFAULT '',
    dominant_colors_json TEXT NOT NULL DEFAULT '[]',
    orientation TEXT NOT NULL DEFAULT 'square',
    aspect_bucket TEXT NOT NULL DEFAULT 'square',
    has_text INTEGER NOT NULL DEFAULT 0,
    exif_json TEXT NOT NULL DEFAULT '{}',
    extraction_version INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(asset_id) REFERENCES assets(id)
  );`,
  `CREATE TABLE IF NOT EXISTS collections (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL
  );`,
  `CREATE TABLE IF NOT EXISTS collection_assets (
    collection_id TEXT NOT NULL,
    asset_id TEXT NOT NULL,
    PRIMARY KEY(collection_id, asset_id),
    FOREIGN KEY(collection_id) REFERENCES collections(id),
    FOREIGN KEY(asset_id) REFERENCES assets(id)
  );`,
  `CREATE TABLE IF NOT EXISTS tags (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE
  );`,
  `CREATE TABLE IF NOT EXISTS asset_tags (
    tag_id TEXT NOT NULL,
    asset_id TEXT NOT NULL,
    PRIMARY KEY(tag_id, asset_id),
    FOREIGN KEY(tag_id) REFERENCES tags(id),
    FOREIGN KEY(asset_id) REFERENCES assets(id)
  );`,
  `CREATE TABLE IF NOT EXISTS index_jobs (
    id TEXT PRIMARY KEY,
    asset_id TEXT NOT NULL,
    stage TEXT NOT NULL,
    status TEXT NOT NULL,
    retries INTEGER NOT NULL,
    error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(asset_id) REFERENCES assets(id)
  );`,
  `CREATE TABLE IF NOT EXISTS saved_searches (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );`
];

const ALTERS = [
  `ALTER TABLE assets ADD COLUMN source_url TEXT;`,
  `ALTER TABLE assets ADD COLUMN title TEXT NOT NULL DEFAULT '';`,
  `ALTER TABLE assets ADD COLUMN user_note TEXT NOT NULL DEFAULT '';`,
  `ALTER TABLE assets ADD COLUMN retrieval_caption TEXT NOT NULL DEFAULT '';`,
  `ALTER TABLE assets ADD COLUMN metadata_json TEXT NOT NULL DEFAULT '{}';`,
  `ALTER TABLE thumbnails ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';`
];

const parseJsonRecord = (value: string | null | undefined): Record<string, unknown> => {
  if (!value) {
    return {};
  }

  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

const parseDominantColors = (value: string | null | undefined): DominantColorFamily[] => {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as string[];
    return Array.isArray(parsed) ? (parsed as DominantColorFamily[]) : [];
  } catch {
    return [];
  }
};

const parseExifRecord = (
  value: string | null | undefined
): Record<string, string | number | boolean | null> => {
  const parsed = parseJsonRecord(value);

  return Object.fromEntries(
    Object.entries(parsed).filter(
      ([, entry]) => ['string', 'number', 'boolean'].includes(typeof entry) || entry === null
    )
  ) as Record<string, string | number | boolean | null>;
};

const defaultEnrichmentFromAsset = (row: {
  width: number;
  height: number;
}): AssetEnrichmentView => ({
  ocrText: '',
  dominantColors: [],
  orientation: deriveOrientation(row.width, row.height),
  aspectBucket: deriveAspectBucket(row.width, row.height),
  hasText: false,
  exif: {},
  extractionVersion: 0,
  updatedAt: ''
});

export class VectorSpaceDb {
  private db: Database.Database;

  public constructor(dbDirectory: string) {
    const dbPath = path.join(dbDirectory, 'vector-space.db');
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.migrate();
  }

  private migrate(): void {
    const tx = this.db.transaction(() => {
      MIGRATIONS.forEach((statement) => this.db.exec(statement));
      ALTERS.forEach((statement) => {
        try {
          this.db.exec(statement);
        } catch {
          // no-op when column already exists
        }
      });
      this.db.exec(
        `UPDATE thumbnails
         SET updated_at = COALESCE(
           NULLIF(updated_at, ''),
           (SELECT created_at FROM assets WHERE assets.id = thumbnails.asset_id),
           CURRENT_TIMESTAMP
         )`
      );
    });
    tx();
  }

  public findAssetByChecksum(checksum: string): string | null {
    const row = this.db
      .prepare('SELECT id FROM assets WHERE checksum = ? LIMIT 1')
      .get(checksum) as { id: string } | undefined;

    return row?.id ?? null;
  }

  public insertAsset(
    asset: AssetRecord,
    originalPath: string,
    originalSize: number,
    thumbnail: {
      path: string;
      width: number;
      height: number;
      updatedAt?: string;
    },
    metadata: {
      title: string;
      userNote: string;
      sourceUrl?: string;
      retrievalCaption: string;
      metadataJson: string;
    }
  ): void {
    const insert = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO assets(
            id, created_at, import_source, mime, width, height, checksum, status, source_path,
            source_url, title, user_note, retrieval_caption, metadata_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          asset.id,
          asset.createdAt,
          asset.importSource,
          asset.mime,
          asset.width,
          asset.height,
          asset.checksum,
          asset.status,
          asset.sourcePath,
          metadata.sourceUrl ?? null,
          metadata.title,
          metadata.userNote,
          metadata.retrievalCaption,
          metadata.metadataJson
        );

      this.db
        .prepare(
          'INSERT INTO asset_files(id, asset_id, role, local_path, size, format) VALUES (?, ?, ?, ?, ?, ?)'
        )
        .run(randomUUID(), asset.id, 'original', originalPath, originalSize, asset.mime);

      this.db
        .prepare(
          `INSERT INTO thumbnails(asset_id, variant, local_path, width, height, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(
          asset.id,
          'grid',
          thumbnail.path,
          thumbnail.width,
          thumbnail.height,
          thumbnail.updatedAt ?? asset.createdAt
        );
    });

    insert();
  }

  public upsertGridThumbnail(
    assetId: string,
    thumbnail: {
      path: string;
      width: number;
      height: number;
      updatedAt?: string;
    }
  ): void {
    this.db
      .prepare(
        `INSERT INTO thumbnails(asset_id, variant, local_path, width, height, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(asset_id, variant) DO UPDATE SET
           local_path = excluded.local_path,
           width = excluded.width,
           height = excluded.height,
           updated_at = excluded.updated_at`
      )
      .run(
        assetId,
        'grid',
        thumbnail.path,
        thumbnail.width,
        thumbnail.height,
        thumbnail.updatedAt ?? new Date().toISOString()
      );
  }

  public updateAssetMetadata(
    assetId: string,
    metadata: {
      title: string;
      userNote: string;
    }
  ): void {
    this.db
      .prepare('UPDATE assets SET title = ?, user_note = ? WHERE id = ?')
      .run(metadata.title.trim(), metadata.userNote.trim(), assetId);
  }

  public updateAssetDerivedFields(
    assetId: string,
    fields: {
      retrievalCaption: string;
      metadataJson: string;
    }
  ): void {
    this.db
      .prepare('UPDATE assets SET retrieval_caption = ?, metadata_json = ? WHERE id = ?')
      .run(fields.retrievalCaption, fields.metadataJson, assetId);
  }

  public upsertAssetEnrichment(
    assetId: string,
    enrichment: {
      ocrText: string;
      dominantColors: DominantColorFamily[];
      orientation: AssetEnrichmentView['orientation'];
      aspectBucket: AssetEnrichmentView['aspectBucket'];
      hasText: boolean;
      exif: Record<string, string | number | boolean | null>;
      extractionVersion: number;
      updatedAt?: string;
    }
  ): void {
    const updatedAt = enrichment.updatedAt ?? new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO asset_enrichments(
          asset_id, ocr_text, dominant_colors_json, orientation, aspect_bucket, has_text,
          exif_json, extraction_version, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(asset_id) DO UPDATE SET
          ocr_text = excluded.ocr_text,
          dominant_colors_json = excluded.dominant_colors_json,
          orientation = excluded.orientation,
          aspect_bucket = excluded.aspect_bucket,
          has_text = excluded.has_text,
          exif_json = excluded.exif_json,
          extraction_version = excluded.extraction_version,
          updated_at = excluded.updated_at`
      )
      .run(
        assetId,
        enrichment.ocrText,
        JSON.stringify(enrichment.dominantColors),
        enrichment.orientation,
        enrichment.aspectBucket,
        enrichment.hasText ? 1 : 0,
        JSON.stringify(enrichment.exif),
        enrichment.extractionVersion,
        updatedAt
      );
  }

  public replaceAssetTextChunks(
    assetId: string,
    chunks: Array<{ section: string; content: string }>
  ): void {
    const tx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM asset_text_chunks WHERE asset_id = ?').run(assetId);
      const insert = this.db.prepare(
        `INSERT INTO asset_text_chunks(id, asset_id, chunk_index, section, content, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      );
      const now = new Date().toISOString();
      chunks.forEach((chunk, index) => {
        insert.run(randomUUID(), assetId, index, chunk.section, chunk.content, now);
      });
    });
    tx();
  }

  public upsertEmbedding(
    record: Omit<EmbeddingRecord, 'dimension'> & {
      provider: string;
      embeddingVersion: string;
    }
  ): void {
    this.db
      .prepare(
        `INSERT INTO embeddings(
          id, asset_id, role, provider, model, task_type, vector_dim, vector_blob, created_at,
          preprocessing_version, extraction_version, ocr_version, embedding_version
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(asset_id, role, provider, model, embedding_version)
        DO UPDATE SET
          task_type = excluded.task_type,
          vector_dim = excluded.vector_dim,
          vector_blob = excluded.vector_blob,
          created_at = excluded.created_at,
          preprocessing_version = excluded.preprocessing_version,
          extraction_version = excluded.extraction_version,
          ocr_version = excluded.ocr_version`
      )
      .run(
        randomUUID(),
        record.assetId,
        record.role,
        record.provider,
        record.model,
        record.taskType,
        record.vector.length,
        JSON.stringify(record.vector),
        new Date().toISOString(),
        record.preprocessingVersion,
        record.extractionVersion,
        record.ocrVersion,
        record.embeddingVersion
      );
  }

  public setAssetStatus(assetId: string, status: string): void {
    this.db.prepare('UPDATE assets SET status = ? WHERE id = ?').run(status, assetId);
  }

  public createIndexJob(assetId: string, stage: string, status: string, error?: string): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        'INSERT INTO index_jobs(id, asset_id, stage, status, retries, error, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .run(randomUUID(), assetId, stage, status, 0, error ?? null, now, now);
  }

  public recoverInterruptedIndexJobs(
    message = 'Indexing stopped before completion. Re-run the asset to try again.'
  ): number {
    const rows = this.db
      .prepare(
        'SELECT rowid, asset_id, stage, status, error, updated_at FROM index_jobs ORDER BY updated_at DESC, rowid DESC'
      )
      .all() as Array<{
      rowid: number;
      asset_id: string;
      stage: string;
      status: IndexJobView['status'];
      error: string | null;
      updated_at: string;
    }>;

    const rowIds = collectInterruptedJobRowIds(
      rows.map((row) => ({
        rowId: row.rowid,
        assetId: row.asset_id,
        stage: row.stage,
        status: row.status,
        error: row.error,
        updatedAt: row.updated_at
      }))
    );

    if (rowIds.length === 0) {
      return 0;
    }

    const now = new Date().toISOString();
    const updateJob = this.db.prepare(
      'UPDATE index_jobs SET status = ?, error = ?, updated_at = ? WHERE rowid = ?'
    );
    const updateAsset = this.db.prepare(
      "UPDATE assets SET status = 'failed' WHERE id IN (SELECT asset_id FROM index_jobs WHERE rowid = ?)"
    );
    const tx = this.db.transaction(() => {
      rowIds.forEach((rowId) => {
        updateJob.run('failed', message, now, rowId);
        updateAsset.run(rowId);
      });
    });

    tx();
    return rowIds.length;
  }

  public listAssets(): AppAssetView[] {
    const rows = this.db
      .prepare(
        `SELECT a.id, a.created_at, a.import_source, a.mime, a.width, a.height, a.status,
        a.title, a.user_note, a.retrieval_caption,
        t.local_path as thumbnail_path,
        t.updated_at as thumbnail_updated_at,
        of.local_path as original_path,
        ae.dominant_colors_json,
        ae.orientation,
        ae.aspect_bucket,
        ae.has_text
        FROM assets a
        LEFT JOIN thumbnails t ON t.asset_id = a.id AND t.variant='grid'
        LEFT JOIN asset_files of ON of.asset_id = a.id AND of.role='original'
        LEFT JOIN asset_enrichments ae ON ae.asset_id = a.id
        ORDER BY a.created_at DESC`
      )
      .all() as Array<{
      id: string;
      created_at: string;
      import_source: AppAssetView['importSource'];
      mime: string;
      width: number;
      height: number;
      status: AssetStatus;
      title: string;
      user_note: string;
      retrieval_caption: string;
      thumbnail_path: string | null;
      thumbnail_updated_at: string | null;
      original_path: string;
      dominant_colors_json: string | null;
      orientation: AssetEnrichmentView['orientation'] | null;
      aspect_bucket: AssetEnrichmentView['aspectBucket'] | null;
      has_text: number | null;
    }>;

    return rows.map((row) => ({
      id: row.id,
      createdAt: row.created_at,
      importSource: row.import_source,
      mime: row.mime,
      width: row.width,
      height: row.height,
      status: row.status,
      thumbnailPath: row.thumbnail_path,
      thumbnailUpdatedAt: row.thumbnail_updated_at,
      originalPath: row.original_path,
      title: row.title,
      userNote: row.user_note,
      retrievalCaption: row.retrieval_caption,
      tags: this.listTagsForAsset(row.id),
      collections: this.listCollectionsForAsset(row.id),
      dominantColors: parseDominantColors(row.dominant_colors_json),
      orientation: row.orientation ?? deriveOrientation(row.width, row.height),
      aspectBucket: row.aspect_bucket ?? deriveAspectBucket(row.width, row.height),
      hasText: Boolean(row.has_text)
    }));
  }

  public listAssetsForThumbnailMaintenance(): Array<{
    assetId: string;
    originalPath: string;
    originalWidth: number;
    originalHeight: number;
    thumbnailPath: string | null;
    thumbnailWidth: number | null;
    thumbnailHeight: number | null;
    thumbnailUpdatedAt: string | null;
  }> {
    const rows = this.db
      .prepare(
        `SELECT a.id as asset_id,
          a.width as original_width,
          a.height as original_height,
          of.local_path as original_path,
          t.local_path as thumbnail_path,
          t.width as thumbnail_width,
          t.height as thumbnail_height,
          t.updated_at as thumbnail_updated_at
        FROM assets a
        LEFT JOIN asset_files of ON of.asset_id = a.id AND of.role='original'
        LEFT JOIN thumbnails t ON t.asset_id = a.id AND t.variant='grid'
        ORDER BY a.created_at DESC`
      )
      .all() as Array<{
      asset_id: string;
      original_path: string;
      original_width: number;
      original_height: number;
      thumbnail_path: string | null;
      thumbnail_width: number | null;
      thumbnail_height: number | null;
      thumbnail_updated_at: string | null;
    }>;

    return rows.map((row) => ({
      assetId: row.asset_id,
      originalPath: row.original_path,
      originalWidth: row.original_width,
      originalHeight: row.original_height,
      thumbnailPath: row.thumbnail_path,
      thumbnailWidth: row.thumbnail_width,
      thumbnailHeight: row.thumbnail_height,
      thumbnailUpdatedAt: row.thumbnail_updated_at
    }));
  }

  public getAssetById(assetId: string): AssetDetailView | null {
    const row = this.db
      .prepare(
        `SELECT a.id, a.created_at, a.import_source, a.mime, a.width, a.height, a.status,
        a.checksum, a.source_path, a.title, a.user_note, a.retrieval_caption, a.metadata_json,
        of.local_path as original_path,
        t.local_path as thumbnail_path,
        t.updated_at as thumbnail_updated_at,
        ae.ocr_text,
        ae.dominant_colors_json,
        ae.orientation,
        ae.aspect_bucket,
        ae.has_text,
        ae.exif_json,
        ae.extraction_version,
        ae.updated_at as enrichment_updated_at
        FROM assets a
        LEFT JOIN asset_files of ON of.asset_id = a.id AND of.role='original'
        LEFT JOIN thumbnails t ON t.asset_id = a.id AND t.variant='grid'
        LEFT JOIN asset_enrichments ae ON ae.asset_id = a.id
        WHERE a.id = ? LIMIT 1`
      )
      .get(assetId) as
      | {
          id: string;
          created_at: string;
          import_source: AppAssetView['importSource'];
          mime: string;
          width: number;
          height: number;
          status: AssetStatus;
          checksum: string;
          source_path: string;
          title: string;
          user_note: string;
          retrieval_caption: string;
          metadata_json: string;
          original_path: string;
          thumbnail_path: string | null;
          thumbnail_updated_at: string | null;
          ocr_text: string | null;
          dominant_colors_json: string | null;
          orientation: AssetEnrichmentView['orientation'] | null;
          aspect_bucket: AssetEnrichmentView['aspectBucket'] | null;
          has_text: number | null;
          exif_json: string | null;
          extraction_version: number | null;
          enrichment_updated_at: string | null;
        }
      | undefined;

    if (!row) {
      return null;
    }

    const tags = this.listTagsForAsset(row.id);
    const collections = this.listCollectionsForAsset(row.id);
    const enrichment =
      row.orientation || row.aspect_bucket || row.dominant_colors_json || row.exif_json
        ? {
            ocrText: row.ocr_text ?? '',
            dominantColors: parseDominantColors(row.dominant_colors_json),
            orientation: row.orientation ?? deriveOrientation(row.width, row.height),
            aspectBucket: row.aspect_bucket ?? deriveAspectBucket(row.width, row.height),
            hasText: Boolean(row.has_text),
            exif: parseExifRecord(row.exif_json),
            extractionVersion: row.extraction_version ?? 0,
            updatedAt: row.enrichment_updated_at ?? ''
          }
        : defaultEnrichmentFromAsset(row);

    return {
      id: row.id,
      createdAt: row.created_at,
      importSource: row.import_source,
      mime: row.mime,
      width: row.width,
      height: row.height,
      status: row.status,
      thumbnailPath: row.thumbnail_path,
      thumbnailUpdatedAt: row.thumbnail_updated_at,
      title: row.title,
      userNote: row.user_note,
      retrievalCaption: row.retrieval_caption,
      originalPath: row.original_path,
      tags,
      collections,
      dominantColors: enrichment.dominantColors,
      orientation: enrichment.orientation,
      aspectBucket: enrichment.aspectBucket,
      hasText: enrichment.hasText,
      checksum: row.checksum,
      sourcePath: row.source_path,
      metadata: parseJsonRecord(row.metadata_json),
      searchDocument: this.getAssetSearchDocument(row.id),
      searchDocumentSections: this.listSearchDocumentSections(row.id),
      tagEntries: this.listTagEntriesForAsset(row.id),
      collectionEntries: this.listCollectionEntriesForAsset(row.id),
      enrichment
    };
  }

  public listEmbeddings(role: EmbeddingRole): Array<{ assetId: string; vector: number[] }> {
    const rows = this.db
      .prepare(
        `SELECT e.asset_id, e.vector_blob FROM embeddings e
        INNER JOIN (
          SELECT asset_id, role, MAX(created_at) as latest
          FROM embeddings
          WHERE role = ?
          GROUP BY asset_id, role
        ) latest_embedding
        ON e.asset_id = latest_embedding.asset_id
          AND e.role = latest_embedding.role
          AND e.created_at = latest_embedding.latest`
      )
      .all(role) as Array<{ asset_id: string; vector_blob: string }>;

    return rows.map((row) => ({
      assetId: row.asset_id,
      vector: JSON.parse(row.vector_blob) as number[]
    }));
  }

  public getAssetSearchDocument(assetId: string): string {
    const row = this.db
      .prepare(`SELECT title, user_note, retrieval_caption FROM assets WHERE id = ? LIMIT 1`)
      .get(assetId) as
      | {
          title: string;
          user_note: string;
          retrieval_caption: string;
        }
      | undefined;

    if (!row) {
      return '';
    }

    const chunks = this.db
      .prepare('SELECT content FROM asset_text_chunks WHERE asset_id = ? ORDER BY chunk_index ASC')
      .all(assetId) as Array<{ content: string }>;

    return [
      row.title,
      row.user_note,
      row.retrieval_caption,
      this.listTagsForAsset(assetId).join(' '),
      this.listCollectionsForAsset(assetId).join(' '),
      chunks.map((chunk) => chunk.content).join(' ')
    ]
      .join(' ')
      .trim();
  }

  public listSearchDocumentSections(assetId: string): Array<{
    section: string;
    content: string;
  }> {
    return this.db
      .prepare(
        'SELECT section, content FROM asset_text_chunks WHERE asset_id = ? ORDER BY chunk_index ASC'
      )
      .all(assetId) as Array<{ section: string; content: string }>;
  }

  public listAssetsForSearch(): Array<{
    assetId: string;
    title: string;
    userNote: string;
    retrievalCaption: string;
    tags: string[];
    collections: string[];
    status: string;
    mime: string;
    createdAt: string;
    dominantColors: DominantColorFamily[];
    orientation: AssetEnrichmentView['orientation'];
    aspectBucket: AssetEnrichmentView['aspectBucket'];
    hasText: boolean;
  }> {
    const rows = this.db
      .prepare(
        `SELECT a.id as asset_id, a.title, a.user_note, a.retrieval_caption, a.status, a.mime, a.created_at,
          a.width, a.height,
          ae.dominant_colors_json,
          ae.orientation,
          ae.aspect_bucket,
          ae.has_text
        FROM assets a
        LEFT JOIN asset_enrichments ae ON ae.asset_id = a.id`
      )
      .all() as Array<{
      asset_id: string;
      title: string;
      user_note: string;
      retrieval_caption: string;
      status: string;
      mime: string;
      created_at: string;
      width: number;
      height: number;
      dominant_colors_json: string | null;
      orientation: AssetEnrichmentView['orientation'] | null;
      aspect_bucket: AssetEnrichmentView['aspectBucket'] | null;
      has_text: number | null;
    }>;

    return rows.map((row) => ({
      assetId: row.asset_id,
      title: row.title,
      userNote: row.user_note,
      retrievalCaption: row.retrieval_caption,
      tags: this.listTagsForAsset(row.asset_id),
      collections: this.listCollectionsForAsset(row.asset_id),
      status: row.status,
      mime: row.mime,
      createdAt: row.created_at,
      dominantColors: parseDominantColors(row.dominant_colors_json),
      orientation: row.orientation ?? deriveOrientation(row.width, row.height),
      aspectBucket: row.aspect_bucket ?? deriveAspectBucket(row.width, row.height),
      hasText: Boolean(row.has_text)
    }));
  }

  public ensureCollection(name: string): string {
    const normalized = name.trim();
    const existing = this.db
      .prepare('SELECT id FROM collections WHERE name = ?')
      .get(normalized) as { id: string } | undefined;
    if (existing) {
      return existing.id;
    }

    const id = randomUUID();
    this.db
      .prepare('INSERT INTO collections(id, name, created_at) VALUES (?, ?, ?)')
      .run(id, normalized, new Date().toISOString());
    return id;
  }

  public attachAssetToCollection(assetId: string, collectionId: string): void {
    this.db
      .prepare('INSERT OR IGNORE INTO collection_assets(collection_id, asset_id) VALUES (?, ?)')
      .run(collectionId, assetId);
  }

  public attachAssetsToCollection(assetIds: string[], collectionId: string): void {
    const insert = this.db.prepare(
      'INSERT OR IGNORE INTO collection_assets(collection_id, asset_id) VALUES (?, ?)'
    );
    const tx = this.db.transaction((ids: string[]) => {
      ids.forEach((assetId) => insert.run(collectionId, assetId));
    });
    tx(Array.from(new Set(assetIds)));
  }

  public detachAssetFromCollection(assetId: string, collectionId: string): void {
    this.db
      .prepare('DELETE FROM collection_assets WHERE collection_id = ? AND asset_id = ?')
      .run(collectionId, assetId);
  }

  public ensureTag(name: string): string {
    const normalized = name.trim().toLowerCase();
    const existing = this.db.prepare('SELECT id FROM tags WHERE name = ?').get(normalized) as
      | { id: string }
      | undefined;
    if (existing) {
      return existing.id;
    }

    const id = randomUUID();
    this.db.prepare('INSERT INTO tags(id, name) VALUES (?, ?)').run(id, normalized);
    return id;
  }

  public attachTagToAsset(assetId: string, tagId: string): void {
    this.db
      .prepare('INSERT OR IGNORE INTO asset_tags(tag_id, asset_id) VALUES (?, ?)')
      .run(tagId, assetId);
  }

  public attachTagToAssets(assetIds: string[], tagId: string): void {
    const insert = this.db.prepare(
      'INSERT OR IGNORE INTO asset_tags(tag_id, asset_id) VALUES (?, ?)'
    );
    const tx = this.db.transaction((ids: string[]) => {
      ids.forEach((assetId) => insert.run(tagId, assetId));
    });
    tx(Array.from(new Set(assetIds)));
  }

  public detachTagFromAsset(assetId: string, tagId: string): void {
    this.db.prepare('DELETE FROM asset_tags WHERE tag_id = ? AND asset_id = ?').run(tagId, assetId);
  }

  public listCollections(): Array<{ id: string; name: string }> {
    return this.db.prepare('SELECT id, name FROM collections ORDER BY name').all() as Array<{
      id: string;
      name: string;
    }>;
  }

  public listTags(): Array<{ id: string; name: string }> {
    return this.db.prepare('SELECT id, name FROM tags ORDER BY name').all() as Array<{
      id: string;
      name: string;
    }>;
  }

  public listTagsForAsset(assetId: string): string[] {
    return (
      this.db
        .prepare(
          'SELECT t.name FROM tags t INNER JOIN asset_tags at ON at.tag_id = t.id WHERE at.asset_id = ? ORDER BY t.name'
        )
        .all(assetId) as Array<{ name: string }>
    ).map((entry) => entry.name);
  }

  public listTagEntriesForAsset(assetId: string): AssetTagView[] {
    return this.db
      .prepare(
        `SELECT t.id, t.name
         FROM tags t
         INNER JOIN asset_tags at ON at.tag_id = t.id
         WHERE at.asset_id = ?
         ORDER BY t.name`
      )
      .all(assetId) as AssetTagView[];
  }

  public listCollectionsForAsset(assetId: string): string[] {
    return (
      this.db
        .prepare(
          'SELECT c.name FROM collections c INNER JOIN collection_assets ca ON ca.collection_id = c.id WHERE ca.asset_id = ? ORDER BY c.name'
        )
        .all(assetId) as Array<{ name: string }>
    ).map((entry) => entry.name);
  }

  public listCollectionEntriesForAsset(assetId: string): AssetCollectionView[] {
    return this.db
      .prepare(
        `SELECT c.id, c.name
         FROM collections c
         INNER JOIN collection_assets ca ON ca.collection_id = c.id
         WHERE ca.asset_id = ?
         ORDER BY c.name`
      )
      .all(assetId) as AssetCollectionView[];
  }

  public saveSearch(payload: SavedSearchPayload): SavedSearchView {
    const now = new Date().toISOString();
    const existing = this.db
      .prepare('SELECT id, created_at FROM saved_searches WHERE name = ? LIMIT 1')
      .get(payload.name) as { id: string; created_at: string } | undefined;
    const id = existing?.id ?? randomUUID();
    const createdAt = existing?.created_at ?? now;

    this.db
      .prepare(
        `INSERT INTO saved_searches(id, name, payload_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(name) DO UPDATE SET
           payload_json = excluded.payload_json,
           updated_at = excluded.updated_at`
      )
      .run(id, payload.name, JSON.stringify(payload), createdAt, now);

    return {
      id,
      createdAt,
      updatedAt: now,
      ...payload
    };
  }

  public listSavedSearches(): SavedSearchView[] {
    const rows = this.db
      .prepare(
        'SELECT id, name, payload_json, created_at, updated_at FROM saved_searches ORDER BY updated_at DESC'
      )
      .all() as Array<{
      id: string;
      name: string;
      payload_json: string;
      created_at: string;
      updated_at: string;
    }>;

    return rows.map((row) => {
      const payload = parseJsonRecord(row.payload_json) as Partial<SavedSearchPayload>;
      return {
        id: row.id,
        name: row.name,
        searchText: typeof payload.searchText === 'string' ? payload.searchText : '',
        searchMode: payload.searchMode === 'similar-image' ? 'similar-image' : 'semantic',
        filters: (payload.filters as SavedSearchPayload['filters']) ?? {},
        createdAt: row.created_at,
        updatedAt: row.updated_at
      };
    });
  }

  public deleteSavedSearch(savedSearchId: string): void {
    this.db.prepare('DELETE FROM saved_searches WHERE id = ?').run(savedSearchId);
  }

  public listIndexJobs(): IndexJobView[] {
    const rows = this.db
      .prepare(
        'SELECT rowid, asset_id, stage, status, error, updated_at FROM index_jobs ORDER BY updated_at DESC, rowid DESC'
      )
      .all() as Array<{
      rowid: number;
      asset_id: string;
      stage: string;
      status: IndexJobView['status'];
      error: string | null;
      updated_at: string;
    }>;

    return collapseIndexJobHistory(
      rows.map((row) => ({
        rowId: row.rowid,
        assetId: row.asset_id,
        stage: row.stage,
        status: row.status,
        error: row.error,
        updatedAt: row.updated_at
      }))
    )
      .slice(0, 100)
      .map(({ rowId: _rowId, ...job }) => job);
  }
}
