import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  supportedImportEntries,
  materializeImportFixture,
  materializeImportFixtures
} from '../test-support/importFixtures';
import type { AssetRecord } from '../types/domain';
import { GEMINI_EMBEDDING_MODEL, GEMINI_EMBEDDING_VERSION } from '../../shared/gemini';
import { getImageMetadata } from './imageProcessing';
import { ImportService } from './importService';

type AssetInsert = {
  asset: AssetRecord;
  originalPath: string;
  originalSize: number;
  thumbPath: string;
  metadata: {
    title: string;
    userNote: string;
    sourceUrl?: string;
    retrievalCaption: string;
    metadataJson: string;
  };
};

class FakeDb {
  public readonly inserts: AssetInsert[] = [];

  public findAssetByChecksum(checksum: string): string | null {
    return this.inserts.find((entry) => entry.asset.checksum === checksum)?.asset.id ?? null;
  }

  public insertAsset(
    asset: AssetRecord,
    originalPath: string,
    originalSize: number,
    thumbPath: string,
    metadata: AssetInsert['metadata']
  ): void {
    this.inserts.push({ asset, originalPath, originalSize, thumbPath, metadata });
  }
}

let tempRoot: string | null = null;
const originalHome = process.env.HOME;

afterEach(async () => {
  process.env.HOME = originalHome;
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
    tempRoot = null;
  }
});

describe('ImportService', () => {
  it('imports every supported image format and creates PNG thumbnails', async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'vector-space-import-test-'));
    process.env.HOME = tempRoot;

    const fixtureDir = path.join(tempRoot, 'fixtures');
    const filePaths = await materializeImportFixtures(fixtureDir);
    const db = new FakeDb();
    const service = new ImportService(db as never);

    const result = await service.importPaths(filePaths, 'file-picker');

    expect(result).toEqual({ imported: supportedImportEntries.length, skipped: 0 });
    expect(db.inserts).toHaveLength(supportedImportEntries.length);

    for (const fixture of supportedImportEntries) {
      const entry = db.inserts.find((record) => record.asset.sourcePath.endsWith(fixture.extension));
      expect(entry?.asset.mime).toBe(fixture.mime);
      expect(entry?.asset.width).toBe(16);
      expect(entry?.asset.height).toBe(16);
      expect(entry?.thumbPath.endsWith('.png')).toBe(true);
      expect(JSON.parse(entry!.metadata.metadataJson).embeddingVersion).toBe(
        GEMINI_EMBEDDING_VERSION
      );
      await stat(entry!.originalPath);
      await stat(entry!.thumbPath);
      const thumbMetadata = await getImageMetadata(entry!.thumbPath);
      expect(thumbMetadata.width).toBe(320);
      expect(thumbMetadata.height).toBe(320);
    }
  });

  it('collects nested supported formats including tif/tiff aliases', async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'vector-space-collect-test-'));
    process.env.HOME = tempRoot;

    const rootDir = path.join(tempRoot, 'source');
    const nestedDir = path.join(rootDir, 'nested');
    const deepDir = path.join(nestedDir, 'deep');
    await mkdir(deepDir, { recursive: true });

    const pngFile = await materializeImportFixture(rootDir, '.png');
    const tifPath = await materializeImportFixture(deepDir, '.tif', 'alias');
    await writeFile(path.join(nestedDir, 'ignore.txt'), 'not-an-image');

    const service = new ImportService(new FakeDb() as never);
    const collected = await service.collectFolderImages(rootDir);

    expect(collected).toHaveLength(2);
    expect(collected).toContain(pngFile);
    expect(collected).toContain(tifPath);
  });

  it('skips duplicates with the same checksum', async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'vector-space-duplicate-test-'));
    process.env.HOME = tempRoot;

    const fixtureDir = path.join(tempRoot, 'fixtures');
    const pngPath = await materializeImportFixture(fixtureDir, '.png');
    const duplicatePath = path.join(fixtureDir, 'duplicate.png');
    await writeFile(duplicatePath, await readFile(pngPath));

    const db = new FakeDb();
    const service = new ImportService(db as never);
    const result = await service.importPaths([pngPath, duplicatePath], 'file-picker');

    expect(result).toEqual({ imported: 1, skipped: 1 });
    expect(db.inserts).toHaveLength(1);
    expect(JSON.parse(db.inserts[0]!.metadata.metadataJson).embeddingVersion).toContain(
      GEMINI_EMBEDDING_MODEL
    );
  });
});
