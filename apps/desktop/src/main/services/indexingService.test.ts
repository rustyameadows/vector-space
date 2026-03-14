import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GEMINI_EMBEDDING_MODEL } from '../../shared/gemini';
import type { AppAssetView, AssetDetailView } from '../types/domain';
import { materializeImportFixture } from '../test-support/importFixtures';
import { IndexingService } from './indexingService';

class FakeDb {
  public readonly assets = new Map<string, AssetDetailView>();

  public readonly assetStatusUpdates: Array<{ assetId: string; status: AppAssetView['status'] }> =
    [];

  public readonly jobs: Array<{
    assetId: string;
    stage: string;
    status: string;
    error?: string;
  }> = [];

  public readonly textChunkWrites: Array<{ assetId: string; chunkCount: number }> = [];

  public readonly embeddings: Array<{ assetId: string; role: string; model: string }> = [];

  public readonly enrichmentWrites: Array<{ assetId: string; hasText: boolean }> = [];

  public readonly derivedUpdates: Array<{ assetId: string; retrievalCaption: string }> = [];

  public listAssets(): AppAssetView[] {
    return Array.from(this.assets.values()).map((asset) => ({
      ...asset
    }));
  }

  public getAssetById(assetId: string) {
    return this.assets.get(assetId) ?? null;
  }

  public setAssetStatus(assetId: string, status: AppAssetView['status']): void {
    const asset = this.assets.get(assetId);
    if (!asset) {
      return;
    }

    asset.status = status;
    this.assetStatusUpdates.push({ assetId, status });
  }

  public createIndexJob(assetId: string, stage: string, status: string, error?: string): void {
    this.jobs.push({ assetId, stage, status, error });
  }

  public replaceAssetTextChunks(
    assetId: string,
    chunks: Array<{ section: string; content: string }>
  ): void {
    this.textChunkWrites.push({ assetId, chunkCount: chunks.length });
  }

  public upsertAssetEnrichment(
    assetId: string,
    enrichment: { hasText: boolean; orientation: string; aspectBucket: string }
  ): void {
    this.enrichmentWrites.push({ assetId, hasText: enrichment.hasText });
    const asset = this.assets.get(assetId);
    if (!asset) {
      return;
    }

    asset.hasText = enrichment.hasText;
    asset.orientation = enrichment.orientation as AssetDetailView['orientation'];
    asset.aspectBucket = enrichment.aspectBucket as AssetDetailView['aspectBucket'];
  }

  public updateAssetDerivedFields(
    assetId: string,
    fields: { retrievalCaption: string; metadataJson: string }
  ): void {
    this.derivedUpdates.push({ assetId, retrievalCaption: fields.retrievalCaption });
    const asset = this.assets.get(assetId);
    if (!asset) {
      return;
    }

    asset.retrievalCaption = fields.retrievalCaption;
    asset.metadata = JSON.parse(fields.metadataJson) as Record<string, unknown>;
  }

  public upsertEmbedding(record: { assetId: string; role: string; model: string }): void {
    this.embeddings.push(record);
  }
}

let tempRoot: string | null = null;

afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
    tempRoot = null;
  }
});

describe('IndexingService', () => {
  it('requeues failed assets and clears live queue state after a successful retry', async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'vector-space-indexing-test-'));
    const imagePath = await materializeImportFixture(tempRoot, '.png', 'retry-target');
    const db = new FakeDb();
    db.assets.set('asset-failed', {
      id: 'asset-failed',
      createdAt: new Date().toISOString(),
      importSource: 'file-picker',
      mime: 'image/png',
      width: 16,
      height: 16,
      title: 'Retry Target',
      userNote: '',
      retrievalCaption: 'Retry Target; Tags: none. Boards: uncategorized. Note: none.',
      thumbnailPath: null,
      thumbnailUpdatedAt: null,
      originalPath: imagePath,
      tags: [],
      collections: [],
      dominantColors: [],
      orientation: 'square',
      aspectBucket: 'square',
      hasText: false,
      status: 'failed',
      checksum: 'checksum',
      sourcePath: imagePath,
      metadata: {},
      searchDocument: '',
      searchDocumentSections: [],
      tagEntries: [],
      collectionEntries: [],
      enrichment: {
        ocrText: '',
        dominantColors: [],
        orientation: 'square',
        aspectBucket: 'square',
        hasText: false,
        exif: {},
        extractionVersion: 0,
        updatedAt: new Date().toISOString()
      }
    });

    const service = new IndexingService(
      db as never,
      {
        name: 'gemini',
        model: GEMINI_EMBEDDING_MODEL,
        preprocessingVersion: 3,
        extractionVersion: 2,
        ocrVersion: 2,
        outputDimensionality: 3072,
        embed: vi.fn().mockResolvedValue([0.1, 0.2, 0.3])
      },
      {
        extract: vi.fn().mockResolvedValue({
          ocrText: 'Retry target',
          dominantColors: ['blue'],
          orientation: 'square',
          aspectBucket: 'square',
          hasText: true,
          exif: {},
          extractionVersion: 2,
          updatedAt: new Date().toISOString()
        })
      }
    );

    service.pause();
    service.retryAssets(['asset-failed']);

    expect(db.assetStatusUpdates.at(-1)).toEqual({ assetId: 'asset-failed', status: 'imported' });
    expect(service.getLiveJobs()).toEqual([
      expect.objectContaining({
        assetId: 'asset-failed',
        stage: 'embedding',
        status: 'queued'
      })
    ]);

    service.resume();

    await vi.waitFor(() => {
      expect(db.assets.get('asset-failed')?.status).toBe('ready');
    });

    expect(service.getLiveJobs()).toEqual([]);
    expect(db.jobs.map((job) => job.status)).toEqual(['running', 'success']);
    expect(db.embeddings).toHaveLength(3);
    expect(db.textChunkWrites[0]?.assetId).toBe('asset-failed');
    expect(db.textChunkWrites[0]?.chunkCount).toBeGreaterThan(1);
    expect(db.enrichmentWrites).toEqual([{ assetId: 'asset-failed', hasText: true }]);
    expect(db.derivedUpdates[0]?.retrievalCaption).toContain('Contains readable text');
  });
});
