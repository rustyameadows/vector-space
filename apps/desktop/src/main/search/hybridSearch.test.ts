import { describe, expect, it } from 'vitest';
import { HybridSearchService } from './hybridSearch';
import type { EmbeddingRole } from '../types/domain';

interface FakeAsset {
  assetId: string;
  title: string;
  userNote: string;
  retrievalCaption: string;
  tags: string[];
  collections: string[];
  status: string;
  mime: string;
  createdAt: string;
  dominantColors: string[];
  orientation: 'portrait' | 'landscape' | 'square';
  aspectBucket: 'wide' | 'portrait' | 'square' | 'standard' | 'tall' | 'ultrawide';
  hasText: boolean;
}

class FakeDb {
  public constructor(
    private readonly assets: FakeAsset[],
    private readonly embeddings: Record<
      EmbeddingRole,
      Array<{ assetId: string; vector: number[] }>
    >,
    private readonly docs: Record<string, string>
  ) {}

  public listAssetsForSearch(): FakeAsset[] {
    return this.assets;
  }

  public listEmbeddings(role: EmbeddingRole): Array<{ assetId: string; vector: number[] }> {
    return this.embeddings[role] ?? [];
  }

  public getAssetSearchDocument(assetId: string): string {
    return this.docs[assetId] ?? '';
  }
}

const assets: FakeAsset[] = [
  {
    assetId: 'dashboard-1',
    title: 'B2B Analytics Dashboard',
    userNote: 'Dense KPI cards and side nav',
    retrievalCaption: 'Dashboard UI with blue cards and table.',
    tags: ['dashboard', 'analytics'],
    collections: ['product'],
    status: 'ready',
    mime: 'image/png',
    createdAt: '2026-01-01T00:00:00.000Z',
    dominantColors: ['blue'],
    orientation: 'landscape',
    aspectBucket: 'wide',
    hasText: true
  },
  {
    assetId: 'editorial-1',
    title: 'Editorial Portfolio',
    userNote: 'Serif hero and asymmetric grid',
    retrievalCaption: 'Editorial website with muted palette.',
    tags: ['portfolio', 'editorial'],
    collections: ['inspiration'],
    status: 'ready',
    mime: 'image/png',
    createdAt: '2026-01-02T00:00:00.000Z',
    dominantColors: ['gray'],
    orientation: 'portrait',
    aspectBucket: 'portrait',
    hasText: false
  },
  {
    assetId: 'not-ready',
    title: 'Pending asset',
    userNote: '',
    retrievalCaption: 'Not indexed',
    tags: ['dashboard'],
    collections: ['product'],
    status: 'imported',
    mime: 'image/png',
    createdAt: '2026-01-03T00:00:00.000Z',
    dominantColors: ['blue'],
    orientation: 'landscape',
    aspectBucket: 'wide',
    hasText: false
  }
];

const embeddings: Record<EmbeddingRole, Array<{ assetId: string; vector: number[] }>> = {
  visual: [
    { assetId: 'dashboard-1', vector: [1, 0, 0] },
    { assetId: 'editorial-1', vector: [0, 1, 0] },
    { assetId: 'not-ready', vector: [1, 0, 0] }
  ],
  text: [
    { assetId: 'dashboard-1', vector: [0.9, 0.1, 0] },
    { assetId: 'editorial-1', vector: [0.1, 0.9, 0] },
    { assetId: 'not-ready', vector: [0.9, 0.1, 0] }
  ],
  joint: [
    { assetId: 'dashboard-1', vector: [0.95, 0.05, 0] },
    { assetId: 'editorial-1', vector: [0.15, 0.85, 0] },
    { assetId: 'not-ready', vector: [0.95, 0.05, 0] }
  ],
  chunk: []
};

const docs = {
  'dashboard-1': 'kpi analytics table cards navigation dashboard metrics',
  'editorial-1': 'portfolio serif editorial magazine asymmetry',
  'not-ready': 'draft'
};

describe('HybridSearchService', () => {
  it('ranks by visual similarity in similarity mode', () => {
    const db = new FakeDb(assets, embeddings, docs);
    const service = new HybridSearchService(db as never);

    const results = service.search({
      mode: 'similarity',
      vectors: { visual: [1, 0, 0], joint: [1, 0, 0] },
      filters: { onlyOfflineReady: true }
    });

    expect(results[0]?.assetId).toBe('dashboard-1');
    expect(results.map((entry) => entry.assetId)).not.toContain('not-ready');
    expect(results[0]?.reasons.join(' ')).toContain('visual similarity');
    expect(results[0]?.explanation.vectorScore).toBeGreaterThan(0.5);
  });

  it('applies lexical matching for text-heavy exploration queries', () => {
    const db = new FakeDb(assets, embeddings, docs);
    const service = new HybridSearchService(db as never);

    const results = service.search({
      mode: 'exploration',
      text: 'serif editorial portfolio',
      vectors: { text: [0, 1, 0], joint: [0, 1, 0] },
      filters: { onlyOfflineReady: true }
    });

    expect(results[0]?.assetId).toBe('editorial-1');
    expect(results[0]?.reasons).toContain('lexical/OCR-style text match');
    expect(results[0]?.explanation.matchedFields).toContain('title');
  });

  it('supports metadata filters for collection and tags', () => {
    const db = new FakeDb(assets, embeddings, docs);
    const service = new HybridSearchService(db as never);

    const results = service.search({
      mode: 'exploration',
      text: 'dashboard analytics',
      vectors: { text: [1, 0, 0], joint: [1, 0, 0] },
      filters: { onlyOfflineReady: true, collectionNames: ['product'], tagNames: ['dashboard'] }
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.assetId).toBe('dashboard-1');
  });

  it('supports enrichment filters for orientation, color, and text presence', () => {
    const db = new FakeDb(assets, embeddings, docs);
    const service = new HybridSearchService(db as never);

    const results = service.search({
      mode: 'exploration',
      text: 'dashboard blue text',
      vectors: { text: [1, 0, 0], joint: [1, 0, 0] },
      filters: {
        onlyOfflineReady: true,
        orientation: 'landscape',
        dominantColors: ['blue'],
        hasText: true
      }
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.assetId).toBe('dashboard-1');
    expect(results[0]?.reasons).toContain('matching color filter');
  });
});
