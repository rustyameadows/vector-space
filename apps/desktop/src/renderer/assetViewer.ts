type AssetIdentity = { id: string };

type FocusTargetLike = {
  tagName?: string;
  isContentEditable?: boolean;
  closest?: (selector: string) => unknown;
};

export const getViewerAssetIndex = (
  assetId: string | null,
  assets: AssetIdentity[]
): number => {
  if (!assetId) {
    return -1;
  }

  return assets.findIndex((asset) => asset.id === assetId);
};

export const getAdjacentViewerAssetId = (
  assetId: string | null,
  assets: AssetIdentity[],
  direction: 'previous' | 'next'
): string | null => {
  const currentIndex = getViewerAssetIndex(assetId, assets);
  if (currentIndex === -1) {
    return null;
  }

  const nextIndex =
    direction === 'previous'
      ? Math.max(0, currentIndex - 1)
      : Math.min(assets.length - 1, currentIndex + 1);

  return assets[nextIndex]?.id ?? null;
};

export const viewerAssetStillVisible = (
  assetId: string | null,
  assets: AssetIdentity[]
): boolean => getViewerAssetIndex(assetId, assets) !== -1;

export const shouldBlockViewerKeyboardNavigation = (target: EventTarget | null): boolean => {
  if (!target || typeof target !== 'object') {
    return false;
  }

  const maybeTarget = target as FocusTargetLike;
  const tagName = maybeTarget.tagName?.toUpperCase();
  if (tagName && ['INPUT', 'TEXTAREA', 'SELECT'].includes(tagName)) {
    return true;
  }

  if (maybeTarget.isContentEditable) {
    return true;
  }

  if (typeof maybeTarget.closest === 'function') {
    return Boolean(maybeTarget.closest('input, textarea, select, [contenteditable="true"]'));
  }

  return false;
};
