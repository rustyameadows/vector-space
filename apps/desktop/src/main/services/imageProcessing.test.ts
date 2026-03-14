import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { materializeImportFixture, resizeFixtureImage } from '../test-support/importFixtures';
import {
  createThumbnail,
  getImageMetadata,
  GRID_THUMBNAIL_MAX_EDGE
} from './imageProcessing';

let tempRoot: string | null = null;

afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
    tempRoot = null;
  }
});

const expectAspectRatioToMatch = (
  original: { width: number; height: number },
  thumbnail: { width: number; height: number }
) => {
  const originalRatio = original.width / original.height;
  const thumbnailRatio = thumbnail.width / thumbnail.height;

  expect(Math.abs(originalRatio - thumbnailRatio)).toBeLessThan(0.02);
  expect(Math.max(thumbnail.width, thumbnail.height)).toBe(GRID_THUMBNAIL_MAX_EDGE);
};

describe('imageProcessing thumbnails', () => {
  it('preserves portrait, landscape, and square aspect ratios when creating thumbnails', async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'vector-space-thumb-test-'));

    const cases = [
      { name: 'portrait', width: 928, height: 1232 },
      { name: 'landscape', width: 1630, height: 337 },
      { name: 'square', width: 1024, height: 1024 }
    ];

    for (const testCase of cases) {
      const sourcePath = await materializeImportFixture(tempRoot, '.png', testCase.name);
      const outputPath = path.join(tempRoot, `${testCase.name}-thumb.png`);
      await resizeFixtureImage(sourcePath, testCase.width, testCase.height);

      const sourceMetadata = await getImageMetadata(sourcePath);
      const thumbnailMetadata = await createThumbnail(sourcePath, outputPath);

      expect(sourceMetadata.width).toBe(testCase.width);
      expect(sourceMetadata.height).toBe(testCase.height);
      expect(thumbnailMetadata.format).toBe('png');
      expectAspectRatioToMatch(sourceMetadata, thumbnailMetadata);
    }
  });
});
