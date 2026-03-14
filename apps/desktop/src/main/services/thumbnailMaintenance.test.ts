import { execFile } from 'node:child_process';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import {
  materializeImportFixture,
  resizeFixtureImage
} from '../test-support/importFixtures';
import { getImageMetadata } from './imageProcessing';
import {
  hasMeaningfulAspectRatioDrift,
  shouldRepairGridThumbnail,
  ThumbnailMaintenanceService,
  type ThumbnailMaintenanceTarget
} from './thumbnailMaintenance';

const execFileAsync = promisify(execFile);
const SIPS_PATH = '/usr/bin/sips';

class FakeDb {
  public constructor(public readonly targets: ThumbnailMaintenanceTarget[]) {}

  public readonly upserts: Array<{
    assetId: string;
    thumbnail: {
      path: string;
      width: number;
      height: number;
      updatedAt?: string;
    };
  }> = [];

  public listAssetsForThumbnailMaintenance(): ThumbnailMaintenanceTarget[] {
    return this.targets;
  }

  public upsertGridThumbnail(
    assetId: string,
    thumbnail: {
      path: string;
      width: number;
      height: number;
      updatedAt?: string;
    }
  ): void {
    this.upserts.push({ assetId, thumbnail });
  }
}

let tempRoot: string | null = null;

afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
    tempRoot = null;
  }
});

describe('thumbnail maintenance', () => {
  it('detects when a thumbnail aspect ratio has drifted from the original asset', () => {
    expect(
      hasMeaningfulAspectRatioDrift(928, 1232, {
        width: 320,
        height: 320
      })
    ).toBe(true);

    expect(
      hasMeaningfulAspectRatioDrift(928, 1232, {
        width: 241,
        height: 320
      })
    ).toBe(false);
  });

  it('repairs legacy square-stretched thumbnails and updates their metadata', async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'vector-space-thumb-repair-test-'));
    const originalPath = await materializeImportFixture(tempRoot, '.png', 'portrait-original');
    await resizeFixtureImage(originalPath, 928, 1232);

    const thumbnailPath = path.join(tempRoot, 'portrait-grid.png');
    await execFileAsync(SIPS_PATH, [
      '-s',
      'format',
      'png',
      '-z',
      '320',
      '320',
      originalPath,
      '--out',
      thumbnailPath
    ]);

    const db = new FakeDb([
      {
        assetId: 'portrait-asset',
        originalPath,
        originalWidth: 928,
        originalHeight: 1232,
        thumbnailPath,
        thumbnailWidth: 320,
        thumbnailHeight: 320,
        thumbnailUpdatedAt: '2026-03-13T20:10:00.000Z'
      }
    ]);

    const service = new ThumbnailMaintenanceService(db);
    const result = await service.repairGridThumbnails();

    const repairedMetadata = await getImageMetadata(thumbnailPath);
    expect(result).toEqual({ scanned: 1, repaired: 1, skipped: 0 });
    expect(repairedMetadata.width).toBeLessThan(repairedMetadata.height);
    expect(Math.max(repairedMetadata.width, repairedMetadata.height)).toBe(320);
    expect(Math.abs(repairedMetadata.width / repairedMetadata.height - 928 / 1232)).toBeLessThan(
      0.02
    );
    expect(db.upserts).toHaveLength(1);
    expect(db.upserts[0]?.thumbnail.width).toBe(repairedMetadata.width);
    expect(db.upserts[0]?.thumbnail.height).toBe(repairedMetadata.height);
    expect(db.upserts[0]?.thumbnail.updatedAt).toMatch(/T/);
  });

  it('recreates missing grid thumbnails for existing assets', async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'vector-space-thumb-missing-test-'));
    const originalPath = await materializeImportFixture(tempRoot, '.png', 'landscape-original');
    await resizeFixtureImage(originalPath, 1630, 337);

    const missingThumbnailPath = path.join(tempRoot, 'missing-grid.png');
    const db = new FakeDb([
      {
        assetId: 'landscape-asset',
        originalPath,
        originalWidth: 1630,
        originalHeight: 337,
        thumbnailPath: missingThumbnailPath,
        thumbnailWidth: 0,
        thumbnailHeight: 0,
        thumbnailUpdatedAt: null
      }
    ]);

    const service = new ThumbnailMaintenanceService(db);
    const result = await service.repairGridThumbnails();

    const repairedMetadata = await getImageMetadata(missingThumbnailPath);
    await stat(missingThumbnailPath);

    expect(result).toEqual({ scanned: 1, repaired: 1, skipped: 0 });
    expect(repairedMetadata.width).toBeGreaterThan(repairedMetadata.height);
    expect(Math.max(repairedMetadata.width, repairedMetadata.height)).toBe(320);
    expect(
      shouldRepairGridThumbnail(
        {
          ...db.targets[0]!,
          thumbnailWidth: repairedMetadata.width,
          thumbnailHeight: repairedMetadata.height,
          thumbnailUpdatedAt: db.upserts[0]?.thumbnail.updatedAt ?? new Date().toISOString()
        },
        {
          width: repairedMetadata.width,
          height: repairedMetadata.height
        }
      )
    ).toBe(false);
    expect(db.upserts[0]?.thumbnail.path).toBe(missingThumbnailPath);
  });
});
