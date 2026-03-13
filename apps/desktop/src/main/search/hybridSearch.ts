import { VectorSpaceDb } from '../db/database';
import type { SearchFilters, SearchResult } from '../types/domain';

const cosine = (a: number[], b: number[]): number => {
  let dot = 0;
  let ma = 0;
  let mb = 0;

  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    dot += av * bv;
    ma += av * av;
    mb += bv * bv;
  }

  return dot / ((Math.sqrt(ma) || 1) * (Math.sqrt(mb) || 1));
};

export class HybridSearchService {
  public constructor(private readonly db: VectorSpaceDb) {}

  public searchByVector(queryVector: number[], filters: SearchFilters = {}): SearchResult[] {
    const embeddings = this.db.listEmbeddings();
    const assets = this.db.listAssets();
    const assetMap = new Map(assets.map((asset) => [asset.id, asset]));

    const results: SearchResult[] = [];

    embeddings.forEach((embedding) => {
      const asset = assetMap.get(embedding.assetId);
      if (!asset) return;
      if (filters.onlyOfflineReady && asset.status !== 'ready') return;
      if (filters.mimePrefix && !asset.mime.startsWith(filters.mimePrefix)) return;
      if (filters.collectionId && !asset.collections.includes(filters.collectionId)) return;
      if (filters.tagIds && filters.tagIds.length > 0) {
        const hasTag = filters.tagIds.every((tag) => asset.tags.includes(tag));
        if (!hasTag) return;
      }

      const similarity = cosine(queryVector, embedding.vector);
      const reasons = ['similar visual embedding'];
      if (asset.tags.length > 0) {
        reasons.push('shared type/category/tag');
      }

      results.push({ assetId: embedding.assetId, score: similarity, reasons });
    });

    return results.sort((a, b) => b.score - a.score);
  }
}
