import { VectorSpaceDb } from '../db/database';
import type { EmbeddingRole, SearchFilters, SearchMode, SearchResult } from '../types/domain';
import type { DominantColorFamily } from '../../shared/contracts';

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

const lexicalScore = (
  document: string,
  query: string
): { score: number; matchedTerms: string[] } => {
  const docTokens = new Set(tokenize(document));
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0 || docTokens.size === 0) {
    return { score: 0, matchedTerms: [] };
  }

  const matchedTerms = Array.from(new Set(queryTokens.filter((token) => docTokens.has(token))));
  return {
    score: matchedTerms.length / queryTokens.length,
    matchedTerms
  };
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

  public search(query: {
    text?: string;
    vectors: Partial<Record<EmbeddingRole, number[]>>;
    mode: SearchMode;
    filters?: SearchFilters;
  }): SearchResult[] {
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
      if (filters.status && filters.status !== 'all' && asset.status !== filters.status) continue;
      if (
        filters.collectionNames?.length &&
        !filters.collectionNames.some((collection) => asset.collections.includes(collection))
      ) {
        continue;
      }
      if (filters.tagNames?.length) {
        const hasAllTags = filters.tagNames.every((tag) => asset.tags.includes(tag));
        if (!hasAllTags) continue;
      }
      if (
        filters.orientation &&
        filters.orientation !== 'all' &&
        asset.orientation !== filters.orientation
      ) {
        continue;
      }
      if (filters.aspectBuckets?.length && !filters.aspectBuckets.includes(asset.aspectBucket)) {
        continue;
      }
      if (
        filters.dominantColors?.length &&
        !filters.dominantColors.some((color) => asset.dominantColors.includes(color))
      ) {
        continue;
      }
      if (typeof filters.hasText === 'boolean' && asset.hasText !== filters.hasText) {
        continue;
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

      const searchDocument = this.db.getAssetSearchDocument(asset.assetId);
      const lexical = query.text
        ? lexicalScore(
            [
              asset.title,
              asset.userNote,
              asset.retrievalCaption,
              asset.tags.join(' '),
              asset.collections.join(' '),
              searchDocument
            ].join(' '),
            query.text
          )
        : { score: 0, matchedTerms: [] };

      const matchedTags = lexical.matchedTerms.filter((term) =>
        asset.tags.some((tag) => tokenize(tag).includes(term))
      );
      const matchedCollections = lexical.matchedTerms.filter((term) =>
        asset.collections.some((collection) => tokenize(collection).includes(term))
      );
      const matchedFields = [
        lexical.matchedTerms.some((term) => tokenize(asset.title).includes(term)) ? 'title' : null,
        lexical.matchedTerms.some((term) => tokenize(asset.userNote).includes(term))
          ? 'note'
          : null,
        lexical.matchedTerms.some((term) => tokenize(asset.retrievalCaption).includes(term))
          ? 'caption'
          : null,
        lexical.matchedTerms.some((term) => tokenize(searchDocument).includes(term))
          ? 'search document'
          : null
      ].filter(Boolean) as string[];
      const matchedColors =
        filters.dominantColors?.filter((color) => asset.dominantColors.includes(color)) ?? [];
      const metadataScore = Math.min(
        1,
        matchedTags.length * 0.18 +
          matchedCollections.length * 0.18 +
          matchedFields.length * 0.1 +
          (matchedColors.length > 0 ? 0.08 : 0) +
          (asset.hasText && lexical.matchedTerms.length > 0 ? 0.06 : 0)
      );

      if (lexical.score > 0.2) {
        reasons.push('lexical/OCR-style text match');
      }
      if (matchedTags.length > 0) {
        reasons.push('matching tags');
      }
      if (matchedCollections.length > 0) {
        reasons.push('matching collections');
      }
      if (matchedColors.length > 0) {
        reasons.push('matching color filter');
      }

      const recencyBoost = query.mode === 'exploration' ? 0.02 : 0;
      const finalScore =
        query.mode === 'exploration'
          ? vectorScore * 0.58 + lexical.score * 0.24 + metadataScore * 0.16 + recencyBoost
          : vectorScore * 0.86 + lexical.score * 0.08 + metadataScore * 0.04 + recencyBoost;
      if (finalScore <= 0) continue;

      results.push({
        assetId: asset.assetId,
        score: finalScore,
        reasons: reasons.length ? Array.from(new Set(reasons)) : ['metadata match'],
        explanation: {
          vectorScore,
          lexicalScore: lexical.score,
          metadataScore,
          recencyBoost,
          matchedFields,
          matchedTerms: lexical.matchedTerms,
          matchedTags: Array.from(new Set(matchedTags)),
          matchedCollections: Array.from(new Set(matchedCollections)),
          matchedColors: matchedColors as DominantColorFamily[],
          snippet:
            asset.userNote.trim() ||
            asset.retrievalCaption.trim() ||
            searchDocument.slice(0, 180) ||
            asset.title
        }
      });
    }

    return results.sort((a, b) => b.score - a.score).slice(0, 120);
  }
}
