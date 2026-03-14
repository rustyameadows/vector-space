import type { AppAssetView, SearchFilters } from '../shared/contracts';

export const toggleStringFilter = (values: string[], nextValue: string): string[] => {
  return values.includes(nextValue)
    ? values.filter((value) => value !== nextValue)
    : [...values, nextValue];
};

export const assetMatchesFilters = (asset: AppAssetView, filters: SearchFilters): boolean => {
  if (filters.mimePrefix && !asset.mime.startsWith(filters.mimePrefix)) {
    return false;
  }

  if (filters.status && filters.status !== 'all' && asset.status !== filters.status) {
    return false;
  }

  if (filters.tagNames?.length) {
    const hasAllTags = filters.tagNames.every((tag) => asset.tags.includes(tag));
    if (!hasAllTags) {
      return false;
    }
  }

  if (
    filters.collectionNames?.length &&
    !filters.collectionNames.some((collection) => asset.collections.includes(collection))
  ) {
    return false;
  }

  if (
    filters.orientation &&
    filters.orientation !== 'all' &&
    asset.orientation !== filters.orientation
  ) {
    return false;
  }

  if (filters.aspectBuckets?.length && !filters.aspectBuckets.includes(asset.aspectBucket)) {
    return false;
  }

  if (
    filters.dominantColors?.length &&
    !filters.dominantColors.some((color) => asset.dominantColors.includes(color))
  ) {
    return false;
  }

  if (typeof filters.hasText === 'boolean' && asset.hasText !== filters.hasText) {
    return false;
  }

  if (filters.onlyOfflineReady && asset.status !== 'ready') {
    return false;
  }

  return true;
};

export const deriveSavedSearchName = (query: string, fallbackIndex: number): string => {
  const trimmed = query.trim();
  if (trimmed.length > 0) {
    return trimmed.slice(0, 36);
  }

  return `Saved view ${fallbackIndex}`;
};
