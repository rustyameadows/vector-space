import { describe, expect, it } from 'vitest';
import type { AppAssetView } from '../shared/contracts';
import { assetMatchesFilters, deriveSavedSearchName, toggleStringFilter } from './libraryFilters';

const asset: AppAssetView = {
  id: 'asset-1',
  createdAt: '2026-03-14T00:00:00.000Z',
  importSource: 'folder',
  mime: 'image/png',
  width: 1200,
  height: 1600,
  status: 'ready',
  thumbnailPath: null,
  thumbnailUpdatedAt: null,
  originalPath: '/tmp/asset.png',
  title: 'Poster study',
  userNote: 'Contains typography',
  retrievalCaption: 'Poster study with blue accents.',
  tags: ['poster', 'typography'],
  collections: ['archive'],
  dominantColors: ['blue', 'white'],
  orientation: 'portrait',
  aspectBucket: 'portrait',
  hasText: true
};

describe('libraryFilters', () => {
  it('matches assets against metadata-rich filters', () => {
    expect(
      assetMatchesFilters(asset, {
        mimePrefix: 'image/',
        status: 'ready',
        tagNames: ['poster'],
        collectionNames: ['archive'],
        orientation: 'portrait',
        dominantColors: ['blue'],
        hasText: true
      })
    ).toBe(true);
  });

  it('toggles filter chip values idempotently', () => {
    expect(toggleStringFilter(['poster'], 'poster')).toEqual([]);
    expect(toggleStringFilter(['poster'], 'blue')).toEqual(['poster', 'blue']);
  });

  it('derives a readable fallback saved-search name', () => {
    expect(deriveSavedSearchName('hero grid reference', 3)).toBe('hero grid reference');
    expect(deriveSavedSearchName('', 3)).toBe('Saved view 3');
  });
});
