type ThumbnailAssetLike = {
  thumbnailPath: string | null;
  thumbnailUpdatedAt: string | null;
};

export const buildLibraryAssetUrl = (
  assetPath: string,
  revision?: string | null
): string => {
  const params = new URLSearchParams({ path: assetPath });
  if (revision) {
    params.set('rev', revision);
  }

  return `app://renderer/library-asset?${params.toString()}`;
};

export const buildThumbnailSrc = (asset: ThumbnailAssetLike): string | null => {
  if (!asset.thumbnailPath) {
    return null;
  }

  return asset.thumbnailPath.startsWith('data:')
    ? asset.thumbnailPath
    : buildLibraryAssetUrl(asset.thumbnailPath, asset.thumbnailUpdatedAt);
};
