import { VectorSpaceDb } from '../db/database';
import type { EmbeddingRole, SearchFilters, SearchMode, SearchResult } from '../types/domain';

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

const tokenize = (value: string): string[] =>
  value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);

const lexicalScore = (document: string, query: string): number => {
  const docTokens = new Set(tokenize(document));
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0 || docTokens.size === 0) return 0;
  const hits = queryTokens.filter((token) => docTokens.has(token)).length;
  return hits / queryTokens.length;
};

const modeWeights: Record<SearchMode, Record<EmbeddingRole, number>> = {
  similarity: {
    visual: 0.55,
    text: 0.15,
    joint: 0.3,
    chunk: 0
  },
  exploration: {
    visual: 0.25,
    text: 0.25,
    joint: 0.5,
    chunk: 0
  }
};

export class HybridSearchService {
  public constructor(private readonly db: VectorSpaceDb) {}

  public search(
    query: {
      text?: string;
      vectors: Partial<Record<EmbeddingRole, number[]>>;
      mode: SearchMode;
      filters?: SearchFilters;
    }
  ): SearchResult[] {
    const filters = query.filters ?? {};
    const assets = this.db.listAssetsForSearch();
    const weightMap = modeWeights[query.mode];
    const roleEmbeddings: Partial<Record<EmbeddingRole, Map<string, number[]>>> = {
      visual: new Map(this.db.listEmbeddings('visual').map((row) => [row.assetId, row.vector])),
      text: new Map(this.db.listEmbeddings('text').map((row) => [row.assetId, row.vector])),
      joint: new Map(this.db.listEmbeddings('joint').map((row) => [row.assetId, row.vector]))
    };

    const results: SearchResult[] = [];

    for (const asset of assets) {
      if (filters.onlyOfflineReady && asset.status !== 'ready') continue;
      if (filters.mimePrefix && !asset.mime.startsWith(filters.mimePrefix)) continue;
      if (filters.collectionName && !asset.collections.includes(filters.collectionName)) continue;
      if (filters.tagNames?.length) {
        const hasAllTags = filters.tagNames.every((tag) => asset.tags.includes(tag));
        if (!hasAllTags) continue;
      }

      let vectorScore = 0;
      const reasons: string[] = [];

      (['visual', 'text', 'joint'] as EmbeddingRole[]).forEach((role) => {
        const queryVector = query.vectors[role];
        const candidateVector = roleEmbeddings[role]?.get(asset.assetId);
        const roleWeight = weightMap[role] ?? 0;
        if (!queryVector || !candidateVector || roleWeight <= 0) {
          return;
        }

        const score = cosine(queryVector, candidateVector);
        vectorScore += score * roleWeight;
        if (score > 0.25) {
          reasons.push(`${role} similarity`);
        }
      });

      const lexical = query.text
        ? lexicalScore(
            [
              asset.title,
              asset.userNote,
              asset.retrievalCaption,
              asset.tags.join(' '),
              asset.collections.join(' '),
              this.db.getAssetSearchDocument(asset.assetId)
            ].join(' '),
            query.text
          )
        : 0;

      if (lexical > 0.2) {
        reasons.push('lexical/OCR-style text match');
      }

      const recencyBoost = query.mode === 'exploration' ? 0.02 : 0;
      const finalScore = vectorScore * 0.8 + lexical * 0.2 + recencyBoost;
      if (finalScore <= 0) continue;

      results.push({
        assetId: asset.assetId,
        score: finalScore,
        reasons: reasons.length ? reasons : ['metadata match']
      });
    }

    return results.sort((a, b) => b.score - a.score).slice(0, 120);
  }
}
