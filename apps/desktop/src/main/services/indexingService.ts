import { promises as fs } from 'node:fs';
import path from 'node:path';
import { VectorSpaceDb } from '../db/database';
import type { EmbeddingProvider } from '../embedding/provider';
import { buildGeminiEmbeddingVersion } from '../../shared/gemini';
import type { IndexJobView } from '../types/domain';

const tokenize = (value: string): string[] =>
  value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);

const dedupeTokens = (tokens: string[]): string[] => Array.from(new Set(tokens));

const splitIntoChunks = (text: string, maxWords = 80): string[] => {
  const words = text
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
  const chunks: string[] = [];
  for (let i = 0; i < words.length; i += maxWords) {
    chunks.push(words.slice(i, i + maxWords).join(' '));
  }
  return chunks;
};

const captionFromAsset = (params: {
  title: string;
  tags: string[];
  collections: string[];
  note: string;
}): string => {
  const style = params.tags.length > 0 ? `Tags: ${params.tags.join(', ')}.` : 'Tags: none.';
  const boards =
    params.collections.length > 0
      ? `Boards: ${params.collections.join(', ')}.`
      : 'Boards: uncategorized.';
  const note = params.note.trim() ? `Note: ${params.note.trim()}.` : 'Note: none.';
  return `${params.title || 'Untitled inspiration'}; ${style} ${boards} ${note}`;
};

export class IndexingService {
  private queue: string[] = [];

  private queuedIds = new Set<string>();

  private enqueuedAt = new Map<string, string>();

  private processing = false;

  private paused = false;

  private activeAssetId: string | null = null;

  private activeUpdatedAt: string | null = null;

  public constructor(
    private readonly db: VectorSpaceDb,
    private readonly provider: EmbeddingProvider
  ) {}

  public enqueue(assetIds: string[]): void {
    assetIds.forEach((id) => {
      if (this.queuedIds.has(id) || this.activeAssetId === id) {
        return;
      }

      this.queue.push(id);
      this.queuedIds.add(id);
      this.enqueuedAt.set(id, new Date().toISOString());
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
    this.retryAssets(this.db.listAssets().map((asset) => asset.id));
  }

  public retryAssets(assetIds: string[]): void {
    const uniqueIds = Array.from(new Set(assetIds));

    uniqueIds.forEach((assetId) => {
      if (!this.db.getAssetById(assetId)) {
        return;
      }

      if (!this.queuedIds.has(assetId) && this.activeAssetId !== assetId) {
        this.db.setAssetStatus(assetId, 'imported');
      }
    });

    this.enqueue(uniqueIds);
  }

  public getLiveJobs(): IndexJobView[] {
    const jobs: IndexJobView[] = [];

    if (this.activeAssetId) {
      jobs.push({
        assetId: this.activeAssetId,
        stage: 'embedding',
        status: 'running',
        error: null,
        updatedAt: this.activeUpdatedAt ?? new Date().toISOString()
      });
    }

    this.queue.forEach((assetId) => {
      jobs.push({
        assetId,
        stage: 'embedding',
        status: 'queued',
        error: null,
        updatedAt: this.enqueuedAt.get(assetId) ?? new Date().toISOString()
      });
    });

    return jobs;
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
      const startedAt = this.enqueuedAt.get(assetId) ?? new Date().toISOString();
      this.enqueuedAt.delete(assetId);
      this.activeAssetId = assetId;
      this.activeUpdatedAt = startedAt;

      const asset = this.db.getAssetById(assetId);
      if (!asset) {
        this.activeAssetId = null;
        this.activeUpdatedAt = null;
        continue;
      }

      try {
        this.db.setAssetStatus(assetId, 'indexing');
        this.db.createIndexJob(assetId, 'embedding', 'running');

        const file = await fs.readFile(asset.originalPath);
        const filenameText = path.basename(asset.originalPath, path.extname(asset.originalPath));
        const pseudoOcrTokens = dedupeTokens(tokenize(filenameText));
        const pseudoOcr = pseudoOcrTokens.join(' ');

        const retrievalCaption = captionFromAsset({
          title: asset.title || filenameText,
          tags: asset.tags,
          collections: asset.collections,
          note: asset.userNote
        });

        const textCorpus = [asset.title, asset.userNote, retrievalCaption, ...asset.tags, pseudoOcr]
          .join('\n')
          .trim();

        const chunks = splitIntoChunks(textCorpus, 40).map((content, index) => ({
          section: index === 0 ? 'summary' : `chunk-${index + 1}`,
          content
        }));
        this.db.replaceAssetTextChunks(assetId, chunks);

        const [visualVector, textVector, jointVector] = await Promise.all([
          this.provider.embed({ taskType: 'RETRIEVAL_DOCUMENT', imageBuffer: file }),
          this.provider.embed({ taskType: 'RETRIEVAL_DOCUMENT', textParts: [textCorpus] }),
          this.provider.embed({
            taskType: 'RETRIEVAL_DOCUMENT',
            imageBuffer: file,
            textParts: [asset.title, retrievalCaption, asset.userNote, pseudoOcr]
          })
        ]);

        const embeddingVersion = buildGeminiEmbeddingVersion({
          model: this.provider.model,
          preprocessingVersion: this.provider.preprocessingVersion,
          extractionVersion: this.provider.extractionVersion,
          ocrVersion: this.provider.ocrVersion
        });

        this.db.upsertEmbedding({
          assetId,
          role: 'visual',
          provider: this.provider.name,
          model: this.provider.model,
          taskType: 'RETRIEVAL_DOCUMENT',
          vector: visualVector,
          preprocessingVersion: this.provider.preprocessingVersion,
          extractionVersion: this.provider.extractionVersion,
          ocrVersion: this.provider.ocrVersion,
          embeddingVersion
        });
        this.db.upsertEmbedding({
          assetId,
          role: 'text',
          provider: this.provider.name,
          model: this.provider.model,
          taskType: 'RETRIEVAL_DOCUMENT',
          vector: textVector,
          preprocessingVersion: this.provider.preprocessingVersion,
          extractionVersion: this.provider.extractionVersion,
          ocrVersion: this.provider.ocrVersion,
          embeddingVersion
        });
        this.db.upsertEmbedding({
          assetId,
          role: 'joint',
          provider: this.provider.name,
          model: this.provider.model,
          taskType: 'RETRIEVAL_DOCUMENT',
          vector: jointVector,
          preprocessingVersion: this.provider.preprocessingVersion,
          extractionVersion: this.provider.extractionVersion,
          ocrVersion: this.provider.ocrVersion,
          embeddingVersion
        });

        this.db.setAssetStatus(assetId, 'ready');
        this.db.createIndexJob(assetId, 'embedding', 'success');
      } catch (error: unknown) {
        this.db.setAssetStatus(assetId, 'failed');
        this.db.createIndexJob(
          assetId,
          'embedding',
          'failed',
          error instanceof Error ? error.message : 'unknown error'
        );
      } finally {
        this.activeAssetId = null;
        this.activeUpdatedAt = null;
      }
    }

    this.processing = false;
  }
}
