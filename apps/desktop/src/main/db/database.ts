import Database from 'better-sqlite3';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AppAssetView, AssetRecord } from '../types/domain';

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
    source_path TEXT NOT NULL
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
    PRIMARY KEY(asset_id, variant),
    FOREIGN KEY(asset_id) REFERENCES assets(id)
  );`,
  `CREATE TABLE IF NOT EXISTS embeddings (
    asset_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    vector_dim INTEGER NOT NULL,
    vector_blob TEXT NOT NULL,
    created_at TEXT NOT NULL,
    version TEXT NOT NULL,
    PRIMARY KEY(asset_id, provider, model, version),
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
  );`
];

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
    thumbPath: string
  ): void {
    const insert = this.db.transaction(() => {
      this.db
        .prepare(
          'INSERT INTO assets(id, created_at, import_source, mime, width, height, checksum, status, source_path) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
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
          asset.sourcePath
        );

      this.db
        .prepare(
          'INSERT INTO asset_files(id, asset_id, role, local_path, size, format) VALUES (?, ?, ?, ?, ?, ?)'
        )
        .run(randomUUID(), asset.id, 'original', originalPath, originalSize, asset.mime);

      this.db
        .prepare(
          'INSERT INTO thumbnails(asset_id, variant, local_path, width, height) VALUES (?, ?, ?, ?, ?)'
        )
        .run(asset.id, 'grid', thumbPath, 320, 320);
    });

    insert();
  }

  public upsertEmbedding(
    assetId: string,
    vector: number[],
    provider: string,
    model: string,
    version: string
  ): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO embeddings(asset_id, provider, model, vector_dim, vector_blob, created_at, version)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        assetId,
        provider,
        model,
        vector.length,
        JSON.stringify(vector),
        new Date().toISOString(),
        version
      );

    this.setAssetStatus(assetId, 'ready');
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

  public listAssets(): AppAssetView[] {
    const rows = this.db
      .prepare(
        `SELECT a.id, a.created_at, a.mime, a.width, a.height, a.status,
        t.local_path as thumbnail_path,
        of.local_path as original_path
        FROM assets a
        LEFT JOIN thumbnails t ON t.asset_id = a.id AND t.variant='grid'
        LEFT JOIN asset_files of ON of.asset_id = a.id AND of.role='original'
        ORDER BY a.created_at DESC`
      )
      .all() as Array<{
      id: string;
      created_at: string;
      mime: string;
      width: number;
      height: number;
      status: 'imported' | 'indexing' | 'ready' | 'failed';
      thumbnail_path: string | null;
      original_path: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      createdAt: row.created_at,
      mime: row.mime,
      width: row.width,
      height: row.height,
      status: row.status,
      thumbnailPath: row.thumbnail_path,
      originalPath: row.original_path,
      tags: this.listTagsForAsset(row.id),
      collections: this.listCollectionsForAsset(row.id)
    }));
  }

  public listEmbeddings(): Array<{ assetId: string; vector: number[] }> {
    const rows = this.db
      .prepare(
        `SELECT e.asset_id, e.vector_blob FROM embeddings e
        INNER JOIN (
          SELECT asset_id, MAX(created_at) as latest
          FROM embeddings
          GROUP BY asset_id
        ) latest_embedding
        ON e.asset_id = latest_embedding.asset_id AND e.created_at = latest_embedding.latest`
      )
      .all() as Array<{ asset_id: string; vector_blob: string }>;

    return rows.map((row) => ({
      assetId: row.asset_id,
      vector: JSON.parse(row.vector_blob) as number[]
    }));
  }

  public ensureCollection(name: string): string {
    const existing = this.db.prepare('SELECT id FROM collections WHERE name = ?').get(name) as
      | { id: string }
      | undefined;
    if (existing) {
      return existing.id;
    }

    const id = randomUUID();
    this.db
      .prepare('INSERT INTO collections(id, name, created_at) VALUES (?, ?, ?)')
      .run(id, name, new Date().toISOString());
    return id;
  }

  public attachAssetToCollection(assetId: string, collectionId: string): void {
    this.db
      .prepare('INSERT OR IGNORE INTO collection_assets(collection_id, asset_id) VALUES (?, ?)')
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

  public listCollectionsForAsset(assetId: string): string[] {
    return (
      this.db
        .prepare(
          'SELECT c.name FROM collections c INNER JOIN collection_assets ca ON ca.collection_id = c.id WHERE ca.asset_id = ? ORDER BY c.name'
        )
        .all(assetId) as Array<{ name: string }>
    ).map((entry) => entry.name);
  }

  public listIndexJobs(): Array<{
    assetId: string;
    stage: string;
    status: string;
    error: string | null;
    updatedAt: string;
  }> {
    const rows = this.db
      .prepare(
        'SELECT asset_id, stage, status, error, updated_at FROM index_jobs ORDER BY updated_at DESC LIMIT 100'
      )
      .all() as Array<{
      asset_id: string;
      stage: string;
      status: string;
      error: string | null;
      updated_at: string;
    }>;

    return rows.map((row) => ({
      assetId: row.asset_id,
      stage: row.stage,
      status: row.status,
      error: row.error,
      updatedAt: row.updated_at
    }));
  }
}
