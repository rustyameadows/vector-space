import { promises as fs } from 'node:fs';
import { VectorSpaceDb } from '../db/database';
import type { EmbeddingProvider } from '../embedding/provider';

export class IndexingService {
  private queue: string[] = [];

  private queuedIds = new Set<string>();

  private processing = false;

  private paused = false;

  public constructor(
    private readonly db: VectorSpaceDb,
    private readonly provider: EmbeddingProvider
  ) {}

  public enqueue(assetIds: string[]): void {
    assetIds.forEach((id) => {
      if (this.queuedIds.has(id)) {
        return;
      }

      this.queue.push(id);
      this.queuedIds.add(id);
    });

    void this.process();
  }

  public pause(): void {
    this.paused = true;
  }

  public resume(): void {
    this.paused = false;
    void this.process();
  }

  public async reindexAll(): Promise<void> {
    const ids = this.db.listAssets().map((asset) => asset.id);
    this.enqueue(ids);
  }

  private async process(): Promise<void> {
    if (this.processing || this.paused) {
      return;
    }

    this.processing = true;

    while (this.queue.length > 0 && !this.paused) {
      const assetId = this.queue.shift();
      if (!assetId) continue;
      this.queuedIds.delete(assetId);

      const asset = this.db.listAssets().find((entry) => entry.id === assetId);
      if (!asset) continue;

      try {
        this.db.setAssetStatus(assetId, 'indexing');
        this.db.createIndexJob(assetId, 'embedding', 'running');
        const file = await fs.readFile(asset.originalPath);
        const vector = await this.provider.embedImage(file);
        this.db.upsertEmbedding(
          assetId,
          vector,
          this.provider.name,
          this.provider.model,
          this.provider.version
        );
        this.db.createIndexJob(assetId, 'embedding', 'success');
      } catch (error: unknown) {
        this.db.setAssetStatus(assetId, 'failed');
        this.db.createIndexJob(
          assetId,
          'embedding',
          'failed',
          error instanceof Error ? error.message : 'unknown error'
        );
      }
    }

    this.processing = false;
  }
}
