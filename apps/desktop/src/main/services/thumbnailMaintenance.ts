import { promises as fs } from 'node:fs';
import { getAssetStorageAbsolutePath } from '../library/pathManager';
import { createThumbnail, getImageMetadata, type ImageMetadata } from './imageProcessing';

const ASPECT_RATIO_REPAIR_TOLERANCE = 0.02;

export type ThumbnailMaintenanceTarget = {
  assetId: string;
  originalPath: string;
  originalWidth: number;
  originalHeight: number;
  thumbnailPath: string | null;
  thumbnailWidth: number | null;
  thumbnailHeight: number | null;
  thumbnailUpdatedAt: string | null;
};

type ThumbnailMaintenanceDb = {
  listAssetsForThumbnailMaintenance: () => ThumbnailMaintenanceTarget[];
  upsertGridThumbnail: (
    assetId: string,
    thumbnail: {
      path: string;
      width: number;
      height: number;
      updatedAt?: string;
    }
  ) => void;
};

export const hasMeaningfulAspectRatioDrift = (
  originalWidth: number,
  originalHeight: number,
  thumbnail: Pick<ImageMetadata, 'width' | 'height'>
): boolean => {
  const originalRatio = originalWidth / Math.max(originalHeight, 1);
  const thumbnailRatio = thumbnail.width / Math.max(thumbnail.height, 1);

  return Math.abs(originalRatio - thumbnailRatio) > ASPECT_RATIO_REPAIR_TOLERANCE;
};

export const shouldRepairGridThumbnail = (
  target: ThumbnailMaintenanceTarget,
  thumbnailMetadata: Pick<ImageMetadata, 'width' | 'height'> | null
): boolean => {
  if (!target.thumbnailPath || !target.thumbnailUpdatedAt) {
    return true;
  }

  if (!Number.isFinite(target.thumbnailWidth) || !Number.isFinite(target.thumbnailHeight)) {
    return true;
  }

  if ((target.thumbnailWidth ?? 0) <= 0 || (target.thumbnailHeight ?? 0) <= 0) {
    return true;
  }

  if (!thumbnailMetadata) {
    return true;
  }

  if (thumbnailMetadata.width <= 0 || thumbnailMetadata.height <= 0) {
    return true;
  }

  return hasMeaningfulAspectRatioDrift(
    target.originalWidth,
    target.originalHeight,
    thumbnailMetadata
  );
};

const resolveThumbnailPath = (target: ThumbnailMaintenanceTarget): string => {
  return (
    target.thumbnailPath ??
    getAssetStorageAbsolutePath(`${target.assetId}-grid`, 'grid.png', 'thumbnails')
  );
};

const readThumbnailMetadata = async (
  thumbnailPath: string | null
): Promise<ImageMetadata | null> => {
  if (!thumbnailPath) {
    return null;
  }

  try {
    await fs.stat(thumbnailPath);
    return await getImageMetadata(thumbnailPath);
  } catch {
    return null;
  }
};

export class ThumbnailMaintenanceService {
  public constructor(private readonly db: ThumbnailMaintenanceDb) {}

  public async repairGridThumbnails(): Promise<{
    scanned: number;
    repaired: number;
    skipped: number;
  }> {
    const targets = this.db.listAssetsForThumbnailMaintenance();
    let repaired = 0;
    let skipped = 0;

    for (const target of targets) {
      if (!target.originalPath) {
        skipped += 1;
        continue;
      }

      const currentMetadata = await readThumbnailMetadata(target.thumbnailPath);
      if (!shouldRepairGridThumbnail(target, currentMetadata)) {
        skipped += 1;
        continue;
      }

      const thumbnailPath = resolveThumbnailPath(target);
      const repairedMetadata = await createThumbnail(target.originalPath, thumbnailPath);
      this.db.upsertGridThumbnail(target.assetId, {
        path: thumbnailPath,
        width: repairedMetadata.width,
        height: repairedMetadata.height,
        updatedAt: new Date().toISOString()
      });
      repaired += 1;
    }

    return {
      scanned: targets.length,
      repaired,
      skipped
    };
  }
}
